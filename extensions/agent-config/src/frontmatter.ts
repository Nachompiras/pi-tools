import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { AgentDocument, EditableAgentConfig } from "./types.js";

const FRONTMATTER_OPEN = /^---\r?\n/;
const FRONTMATTER_CLOSE = /(?:^|\r?\n)---(\r?\n|$)/;

export function parseAgentDocument(content: string): AgentDocument {
  if (!FRONTMATTER_OPEN.test(content)) {
    return { frontmatter: {}, body: content, hadFrontmatter: false };
  }

  // Find the first newline (end of opening delimiter)
  const firstNewline = content.indexOf("\n");
  const afterOpening = content.slice(firstNewline + 1);

  // Find the first standalone closing delimiter
  const closeMatch = afterOpening.match(FRONTMATTER_CLOSE);

  if (!closeMatch || closeMatch.index === undefined) {
    throw new Error("Unterminated frontmatter: no closing --- delimiter found");
  }

  const yamlContent = afterOpening.slice(0, closeMatch.index);
  const bodyStart = closeMatch.index + closeMatch[0].length;
  const body = afterOpening.slice(bodyStart);

  let frontmatter: unknown;
  try {
    frontmatter = parseYaml(yamlContent);
  } catch (e) {
    throw new Error(
      `Malformed YAML in frontmatter: ${(e as Error).message}`,
    );
  }

  // Empty/whitespace-only frontmatter is a valid empty mapping
  if (frontmatter === null || frontmatter === undefined) {
    frontmatter = {};
  }

  if (
    typeof frontmatter !== "object" ||
    Array.isArray(frontmatter)
  ) {
    throw new Error(
      "Frontmatter must be a YAML mapping (object), got: " +
        (Array.isArray(frontmatter) ? "array" : typeof frontmatter),
    );
  }

  return {
    frontmatter: frontmatter as Record<string, unknown>,
    body,
    hadFrontmatter: true,
  };
}

export function updateAgentDocument(
  content: string,
  config: EditableAgentConfig,
): string {
  const doc = parseAgentDocument(content);

  // Apply model (only when explicitly provided; undefined removes the key)
  if ("model" in config) {
    if (config.model !== undefined) {
      doc.frontmatter.model = config.model;
    } else {
      delete doc.frontmatter.model;
    }
  }

  // Apply thinking
  if ("thinking" in config) {
    if (config.thinking !== undefined) {
      doc.frontmatter.thinking = config.thinking;
    } else {
      delete doc.frontmatter.thinking;
    }
  }

  // Apply maxTurns -> on-disk max_turns
  if ("maxTurns" in config) {
    if (config.maxTurns !== undefined) {
      doc.frontmatter.max_turns = config.maxTurns;
    } else {
      delete doc.frontmatter.max_turns;
    }
  }

  const keys = Object.keys(doc.frontmatter);
  if (keys.length === 0) {
    return doc.body;
  }

  const yamlStr = stringifyYaml(doc.frontmatter, { lineWidth: 0 });
  // stringifyYaml appends a trailing newline, which separates YAML from closing ---
  return `---\n${yamlStr}---\n${doc.body}`;
}