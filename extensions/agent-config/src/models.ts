import type { ModelChoices, ModelDescriptor } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Is the value a non-empty string? */
function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/** Does the string contain any control characters (0x00-0x1F, 0x7F) or slash? */
function hasControlOrSlash(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 0x1f || c === 0x7f || s[i] === "/") return true;
  }
  return false;
}

/** Does the string contain any control characters (0x00-0x1F, 0x7F)? */
function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 0x1f || c === 0x7f) return true;
  }
  return false;
}

/**
 * Validate a single ModelDescriptor. Returns the descriptor if valid,
 * or undefined if it should be skipped.
 */
function validateDescriptor(
  d: unknown,
): ModelDescriptor | undefined {
  if (d === null || d === undefined || typeof d !== "object") return undefined;
  const obj = d as Record<string, unknown>;
  if (!isNonEmptyString(obj.provider)) return undefined;
  if (!isNonEmptyString(obj.id)) return undefined;
  if (hasControlOrSlash(obj.provider)) return undefined;
  if (hasControlChars(obj.id)) return undefined;
  const name = obj.name;
  if (name !== undefined && typeof name !== "string") return undefined;
  return {
    provider: obj.provider,
    id: obj.id,
    name: typeof name === "string" ? name : undefined,
  };
}

/**
 * Full identifier for a model: "provider/id".
 */
export function modelFullId(model: ModelDescriptor): string {
  return `${model.provider}/${model.id}`;
}

/**
 * Sort models deterministically by code-point order: provider, then id.
 * Does NOT use localeCompare so ordering is independent of system locale.
 */
function sortModels(models: ModelDescriptor[]): ModelDescriptor[] {
  return [...models].sort((a, b) => {
    if (a.provider < b.provider) return -1;
    if (a.provider > b.provider) return 1;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
}

/**
 * Normalize and deduplicate models by exact provider/id.
 * First occurrence wins (preserves name).
 */
function normalizeModels(models: ModelDescriptor[]): ModelDescriptor[] {
  const seen = new Map<string, ModelDescriptor>();
  for (const m of models) {
    const key = `${m.provider}\x00${m.id}`;
    if (!seen.has(key)) {
      seen.set(key, m);
    }
  }
  return sortModels([...seen.values()]);
}

// ---------------------------------------------------------------------------
// Pattern matching (Pi-compatible subset)
// ---------------------------------------------------------------------------

/**
 * Check if a pattern contains glob characters.
 * Only `*` triggers glob matching. `?` and `[...]` are treated as
 * literal characters, not as single-char wildcard / character class.
 * This keeps the contract minimal and well-defined.
 */
function isGlobPattern(pattern: string): boolean {
  return pattern.includes("*");
}

/**
 * Convert a simple glob pattern to a case-insensitive regex.
 * Only `*` is treated as a wildcard (any characters). Every other
 * character is escaped so that regex metacharacters are matched
 * literally. This prevents malformed regex and undocumented partial
 * semantics.
 */
function globToRegex(pattern: string): RegExp {
  let regexStr = "^";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") {
      regexStr += ".*";
    } else {
      // Escape all regex special characters
      if ("^$\\.+(){}[]|?".includes(ch)) {
        regexStr += "\\" + ch;
      } else {
        regexStr += ch;
      }
    }
  }
  regexStr += "$";
  return new RegExp(regexStr, "i");
}

/**
 * Match a pattern against the available models.
 * Follows Pi semantics:
 * 1. Try exact provider/id match (case-insensitive)
 * 2. Try exact bare model ID match (case-insensitive)
 * 3. If glob, match against "provider/id" and bare "id"
 * 4. Partial/fuzzy: match against id and name (case-insensitive)
 *
 * Returns matched models in deterministic sorted order.
 */
function matchPattern(
  pattern: string,
  allModels: ModelDescriptor[],
): ModelDescriptor[] {
  const lower = pattern.toLowerCase();

  // 1. Exact provider/id match
  const exactFull = allModels.filter(
    (m) => `${m.provider}/${m.id}`.toLowerCase() === lower,
  );
  if (exactFull.length > 0) return exactFull;

  // 2. Exact bare model ID match
  const exactBare = allModels.filter(
    (m) => m.id.toLowerCase() === lower,
  );
  if (exactBare.length === 1) return exactBare;

  // 3. Glob pattern
  if (isGlobPattern(pattern)) {
    const regex = globToRegex(pattern);
    const globMatches = allModels.filter((m) => {
      const fullId = `${m.provider}/${m.id}`;
      return regex.test(fullId) || regex.test(m.id);
    });
    if (globMatches.length > 0) return sortModels(globMatches);
  }

  // 4. Partial/fuzzy: match against id and name (case-insensitive)
  const fuzzyMatches = allModels.filter(
    (m) =>
      m.id.toLowerCase().includes(lower) ||
      (m.name !== undefined && m.name.toLowerCase().includes(lower)),
  );
  if (fuzzyMatches.length === 0) return [];

  // Prefer aliases (non-dated) over dated versions
  const aliases = fuzzyMatches.filter((m) => isAlias(m.id));
  if (aliases.length > 0) {
    return [aliases.sort((a, b) => b.id.localeCompare(a.id))[0]];
  }
  // Pick latest dated version
  return [fuzzyMatches.sort((a, b) => b.id.localeCompare(a.id))[0]];
}

/**
 * Check if a model ID looks like an alias (no date suffix).
 * Dates are typically in format: -YYYYMMDD.
 */
function isAlias(id: string): boolean {
  if (id.endsWith("-latest")) return true;
  const datePattern = /-\d{8}$/;
  return !datePattern.test(id);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build model choices from a flat list of descriptors and optional
 * enabled patterns.
 *
 * All models are normalized (deduplicated by provider/id) and sorted
 * deterministically. Enabled patterns are matched against the full set
 * using Pi-compatible semantics (exact provider/id, bare ID, globs, fuzzy).
 *
 * Enabled results retain the order of enabledPatterns; models within each
 * pattern are sorted deterministically. Overlapping matches are deduplicated.
 * Patterns that match no models are silently omitted.
 *
 * If enabledPatterns is undefined or empty, `enabled` is an empty array
 * (meaning no scoped subset — UI should fall back to `all`).
 */
export function buildModelChoices(
  allModels: ModelDescriptor[],
  enabledPatterns?: string[],
): ModelChoices {
  // Validate and normalize
  const valid: ModelDescriptor[] = [];
  for (const m of allModels) {
    const d = validateDescriptor(m);
    if (d) valid.push(d);
  }
  const all = normalizeModels(valid);

  if (!enabledPatterns || enabledPatterns.length === 0) {
    return { enabled: [], all };
  }

  const seen = new Set<string>();
  const enabled: ModelDescriptor[] = [];

  for (const pattern of enabledPatterns) {
    const matches = matchPattern(pattern, all);
    for (const m of matches) {
      const key = modelFullId(m);
      if (!seen.has(key)) {
        seen.add(key);
        enabled.push(m);
      }
    }
  }

  return { enabled, all };
}

/**
 * Validate a manually-entered model value.
 *
 * Accepts fuzzy names (e.g. "sonnet"), full IDs (e.g. "anthropic/claude-sonnet"),
 * and trims surrounding whitespace. Does NOT require the value to resolve to
 * a known model in the registry.
 *
 * Rejects:
 * - Empty or whitespace-only strings
 * - Strings containing control characters (0x00-0x1F, 0x7F)
 * - Strings containing CR, LF, or multiline content
 *
 * Returns the normalized trimmed string on success.
 */
export function validateManualModel(value: string): string {
  // Check for CR/LF in original value (before trim, to catch trailing too)
  if (value.includes("\r") || value.includes("\n")) {
    throw new Error("Model value must not contain line breaks");
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error("Model value must not be empty");
  }
  if (hasControlChars(trimmed)) {
    throw new Error("Model value contains invalid characters");
  }
  return trimmed;
}