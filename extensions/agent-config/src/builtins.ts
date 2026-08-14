import { join } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { stringify as stringifyYaml } from "yaml";

// ---------------------------------------------------------------------------
// Dependency injection for testing
// ----------------------------------------------------------------------------

/**
 * Override hook for `loadBuiltinDefaults`.  When set (e.g. by a test), the
 * override is called instead of the real implementation.  This allows tests to
 * simulate "package not found" conditions without needing to uninstall the real
 * @tintinweb/pi-subagents dependency.
 *
 * The setter is re-assignable so vitest can restore the original after each
 * test via `vi.mockRestore()` on the owning module.
 */
let loadBuiltinDefaultsOverride: ((
  packageDir: string,
) => Promise<Map<string, BuiltinAgentConfig> | null>) | null = null;

/**
 * Set the override for `loadBuiltinDefaults`.  Pass `null` to restore the
 * real implementation.
 */
export function setLoadBuiltinDefaultsOverride(
  fn: typeof loadBuiltinDefaults | null,
): void {
  loadBuiltinDefaultsOverride = fn;
}
import { validateAgentName } from "./discovery.js";
import type { AgentSource, BuiltinLoadResult } from "./types.js";

// ---------------------------------------------------------------------------
// Minimal type matching AgentConfig fields used by serialization
// ---------------------------------------------------------------------------

interface BuiltinAgentConfig {
  name: string;
  displayName?: string;
  description: string;
  builtinToolNames?: string[];
  extensions: true | string[] | false;
  excludeExtensions?: string[];
  skills: true | string[] | false;
  disallowedTools?: string[];
  model?: string;
  thinking?: string;
  maxTurns?: number;
  systemPrompt: string;
  promptMode: string;
  inheritContext?: boolean;
  runInBackground?: boolean;
  outputTranscript?: boolean;
  isolated?: boolean;
  memory?: string;
  isolation?: string;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isBoolean(v: unknown): v is boolean {
  return typeof v === "boolean";
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((item) => typeof item === "string");
}

function isFinitePositiveInteger(v: unknown): v is number {
  return (
    typeof v === "number" &&
    Number.isFinite(v) &&
    v > 0 &&
    Number.isInteger(v)
  );
}

function isExtensionsOrSkills(v: unknown): v is true | string[] | false {
  if (v === true || v === false) return true;
  return isStringArray(v);
}

/**
 * Validate a single built-in agent configuration entry.
 * Returns a list of field-level error messages, or an empty array when valid.
 */
function validateBuiltinConfig(
  name: string,
  cfg: unknown,
): string[] {
  const errors: string[] = [];

  // Must be a non-null, non-array object
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) {
    return ["Configuration must be a non-null object"];
  }

  const c = cfg as Record<string, unknown>;

  // cfg.name must be a non-empty string
  if (!isString(c.name)) {
    errors.push("name must be a string");
  } else if (c.name.length === 0) {
    errors.push("name must not be empty");
  } else if (c.name !== name) {
    errors.push(`name "${c.name}" does not match map key "${name}"`);
  }

  // Validate agent name safety (path traversal, etc.)
  if (isString(c.name) && c.name.length > 0) {
    try {
      validateAgentName(c.name);
    } catch (e) {
      errors.push(`name is unsafe: ${(e as Error).message}`);
    }
  }

  // description must be a string
  if (!isString(c.description)) {
    errors.push("description must be a string");
  }

  // systemPrompt must be a string (empty allowed)
  if (!isString(c.systemPrompt)) {
    errors.push("systemPrompt must be a string");
  }

  // promptMode must be a string
  if (!isString(c.promptMode)) {
    errors.push("promptMode must be a string");
  }

  // extensions must be true, false, or string[]
  if (!isExtensionsOrSkills(c.extensions)) {
    errors.push("extensions must be true, false, or string[]");
  }

  // skills must be true, false, or string[]
  if (!isExtensionsOrSkills(c.skills)) {
    errors.push("skills must be true, false, or string[]");
  }

  // Optional arrays must contain only strings
  if (c.excludeExtensions !== undefined && !isStringArray(c.excludeExtensions)) {
    errors.push("excludeExtensions must be string[]");
  }
  if (c.disallowedTools !== undefined && !isStringArray(c.disallowedTools)) {
    errors.push("disallowedTools must be string[]");
  }
  if (c.builtinToolNames !== undefined && !isStringArray(c.builtinToolNames)) {
    errors.push("builtinToolNames must be string[]");
  }

  // Optional strings
  if (c.model !== undefined && !isString(c.model)) {
    errors.push("model must be a string");
  }
  if (c.thinking !== undefined && !isString(c.thinking)) {
    errors.push("thinking must be a string");
  }
  if (c.displayName !== undefined && !isString(c.displayName)) {
    errors.push("displayName must be a string");
  }
  if (c.memory !== undefined && !isString(c.memory)) {
    errors.push("memory must be a string");
  }
  if (c.isolation !== undefined && !isString(c.isolation)) {
    errors.push("isolation must be a string");
  }

  // maxTurns: if present, must be a finite positive integer
  if (c.maxTurns !== undefined && !isFinitePositiveInteger(c.maxTurns)) {
    errors.push("maxTurns must be a finite positive integer");
  }

  // Optional booleans
  if (c.inheritContext !== undefined && !isBoolean(c.inheritContext)) {
    errors.push("inheritContext must be a boolean");
  }
  if (c.runInBackground !== undefined && !isBoolean(c.runInBackground)) {
    errors.push("runInBackground must be a boolean");
  }
  if (c.outputTranscript !== undefined && !isBoolean(c.outputTranscript)) {
    errors.push("outputTranscript must be a boolean");
  }
  if (c.isolated !== undefined && !isBoolean(c.isolated)) {
    errors.push("isolated must be a boolean");
  }

  return errors;
}

// ---------------------------------------------------------------------------
// serializeBuiltinAgent
// ---------------------------------------------------------------------------

/**
 * Serialize an agent configuration into a complete Markdown document with YAML
 * frontmatter, matching the semantics of the ejectAgent workflow in
 * @tintinweb/pi-subagents.
 *
 * Uses the `yaml` package to serialize a frontmatter object, ensuring all
 * scalar values are properly quoted and escaped — no raw string interpolation.
 *
 * Throws on invalid configuration — the caller should validate before calling
 * or handle the error.
 */
export function serializeBuiltinAgent(cfg: BuiltinAgentConfig): string {
  // Validate before serializing
  const errors = validateBuiltinConfig(cfg.name ?? "(unknown)", cfg);
  if (errors.length > 0) {
    throw new Error(
      `Invalid built-in agent configuration: ${errors.join("; ")}`,
    );
  }

  const fmObj: Record<string, unknown> = {};

  fmObj.description = cfg.description;
  if (cfg.displayName) fmObj.display_name = cfg.displayName;
  fmObj.tools = cfg.builtinToolNames?.join(", ") ?? "all";
  if (cfg.model) fmObj.model = cfg.model;
  if (cfg.thinking) fmObj.thinking = cfg.thinking;
  if (cfg.maxTurns) fmObj.max_turns = cfg.maxTurns;
  fmObj.prompt_mode = cfg.promptMode;

  if (cfg.extensions === false) fmObj.extensions = false;
  else if (Array.isArray(cfg.extensions))
    fmObj.extensions = cfg.extensions;

  if (cfg.excludeExtensions?.length)
    fmObj.exclude_extensions = cfg.excludeExtensions;

  if (cfg.skills === false) fmObj.skills = false;
  else if (Array.isArray(cfg.skills))
    fmObj.skills = cfg.skills;

  if (cfg.disallowedTools?.length)
    fmObj.disallowed_tools = cfg.disallowedTools;

  if (cfg.inheritContext) fmObj.inherit_context = true;
  if (cfg.runInBackground) fmObj.run_in_background = true;
  if (cfg.outputTranscript === false) fmObj.output_transcript = false;
  if (cfg.isolated) fmObj.isolated = true;
  if (cfg.memory) fmObj.memory = cfg.memory;
  if (cfg.isolation) fmObj.isolation = cfg.isolation;

  const yamlStr = stringifyYaml(fmObj, { lineWidth: 0 });
  // stringifyYaml appends a trailing newline, which separates YAML from
  // closing ---; the body is separated by a blank line and terminated with
  // a trailing newline (matching ejectAgent semantics).
  return `---\n${yamlStr}---\n\n${cfg.systemPrompt}\n`;
}

// ---------------------------------------------------------------------------
// Resolution candidates
// ---------------------------------------------------------------------------

/**
 * Resolve candidate package directories for pi-subagents.
 *
 * Returns an ordered list of candidate package directories:
 * 1. configDir/npm/node_modules/@tintinweb/pi-subagents (explicit path)
 * 2. Node module resolution via createRequire from the extension's context
 *
 * The second candidate uses createRequire to find the package root from the
 * normal Node module resolution algorithm, then loads dist/default-agents.js
 * by file URL. This avoids claiming an unproven bare dynamic import and
 * provides deterministic, testable resolution.
 */
export function resolveBuiltinCandidates(configDir: string): string[] {
  const candidates: string[] = [];

  // 1. Explicit configDir path
  candidates.push(
    join(configDir, "npm", "node_modules", "@tintinweb", "pi-subagents"),
  );

  // 2. Normal Node module resolution via createRequire
  try {
    const req = createRequire(import.meta.url);
    const pkgJsonPath = req.resolve(
      "@tintinweb/pi-subagents/package.json",
    );
    const pkgRoot = join(pkgJsonPath, "..");
    candidates.push(pkgRoot);
  } catch {
    // Package not available via Node resolution — only the explicit path
    // remains as a candidate
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// loadBuiltinDefaults
// ---------------------------------------------------------------------------

/**
 * Last error encountered during a loadBuiltinDefaults call, preserved for
 * caller diagnostics. Reset on each call.
 */
let lastLoadError: string | undefined;

/**
 * Return the last error message from loadBuiltinDefaults, if any.
 * Useful for callers that need to distinguish between different failure modes.
 */
export function getLastLoadError(): string | undefined {
  return lastLoadError;
}

/**
 * Load the DEFAULT_AGENTS map from a resolved pi-subagents package directory.
 * Returns null when the package is missing or its exports cannot be loaded.
 *
 * Uses a direct file import (pathToFileURL) to avoid Node module resolution
 * caching issues across test fixtures; the caller is responsible for providing
 * a unique directory path when deterministic isolation is required.
 */
export async function loadBuiltinDefaults(
  packageDir: string,
): Promise<Map<string, BuiltinAgentConfig> | null> {
  lastLoadError = undefined;
  try {
    const modPath = join(packageDir, "dist", "default-agents.js");
    const mod = await import(pathToFileURL(modPath).href);
    if (mod.DEFAULT_AGENTS instanceof Map) {
      return mod.DEFAULT_AGENTS as Map<string, BuiltinAgentConfig>;
    }
    lastLoadError = "Module does not export DEFAULT_AGENTS as a Map";
    return null;
  } catch (e) {
    lastLoadError = (e as Error).message;
    return null;
  }
}

// ---------------------------------------------------------------------------
// loadBuiltinAgentSources
// ---------------------------------------------------------------------------

/**
 * Load built-in subagent definitions from the installed @tintinweb/pi-subagents
 * package and serialize them as AgentSource entries with kind "builtin".
 *
 * Resolution order:
 * 1. configDir/npm/node_modules/@tintinweb/pi-subagents
 * 2. Normal Node module resolution via createRequire
 *
 * On failure, returns empty sources and an actionable warning directing the
 * user to eject the agent through /agents. Never invents a generic prompt.
 *
 * Every Map entry is validated before serialization; invalid entries are
 * skipped and a warning with the count of failed entries and their safe names
 * is emitted.
 */
export async function loadBuiltinAgentSources(
  configDir?: string,
): Promise<BuiltinLoadResult> {
  // Resolve the base config directory
  const resolvedConfigDir =
    configDir ??
    process.env.PI_CODING_AGENT_DIR ??
    join(homedir(), ".pi", "agent");

  const candidates = resolveBuiltinCandidates(resolvedConfigDir);

  let defaults: Map<string, BuiltinAgentConfig> | null = null;

  for (const candidate of candidates) {
    defaults = loadBuiltinDefaultsOverride
      ? await loadBuiltinDefaultsOverride(candidate)
      : await loadBuiltinDefaults(candidate);
    if (defaults) break;
  }

  if (!defaults) {
    const detail =
      lastLoadError && lastLoadError.includes("Cannot find")
        ? "Package @tintinweb/pi-subagents is not installed. "
        : "Built-in agent definitions from @tintinweb/pi-subagents are not available. ";
    return {
      sources: [],
      warning:
        detail +
        "To configure a built-in agent, eject it first through /agents, then use /agent-config.",
    };
  }

  const sources: AgentSource[] = [];
  const failedNames: string[] = [];
  let skipped = 0;

  for (const [name, cfg] of defaults) {
    // Validate map key (agent name)
    if (!isString(name) || name.length === 0) {
      skipped++;
      continue;
    }

    try {
      validateAgentName(name);
    } catch {
      skipped++;
      continue;
    }

    // Validate the config entry
    const errors = validateBuiltinConfig(name, cfg);
    if (errors.length > 0) {
      skipped++;
      failedNames.push(name);
      continue;
    }

    try {
      const content = serializeBuiltinAgent(cfg as BuiltinAgentConfig);
      sources.push({ name, kind: "builtin", content });
    } catch {
      // Skip entries that fail serialization (shouldn't happen after validation,
      // but kept as a safety net)
      skipped++;
      failedNames.push(name);
    }
  }

  let warning: string | undefined;
  if (skipped > 0) {
    const parts: string[] = [];
    parts.push(
      `${skipped} built-in agent definition(s) could not be loaded`,
    );
    if (failedNames.length > 0) {
      parts.push(`(${failedNames.join(", ")})`);
    }
    parts.push(". Eject the affected agent through /agents first.");
    warning = parts.join(" ");
  }

  return { sources, warning };
}
