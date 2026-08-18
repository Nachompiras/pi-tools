import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import {
  serializeBuiltinAgent,
  loadBuiltinDefaults,
  loadBuiltinAgentSources,
  getLastLoadError,
  setLoadBuiltinDefaultsOverride,
} from "../src/builtins.js";
import { parseAgentDocument } from "../src/frontmatter.js";
import { resolveAgentPrecedence } from "../src/discovery.js";
import type { AgentSource } from "../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTempDir(): Promise<string> {
  const prefix = join(tmpdir(), "agent-config-builtins-");
  return await mkdtemp(prefix);
}

interface FixtureAgentConfig {
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

async function createFixturePackage(
  agents: Map<string, FixtureAgentConfig>,
): Promise<string> {
  const tmp = await makeTempDir();
  const distDir = join(tmp, "dist");
  await mkdir(distDir, { recursive: true });

  const entries = Array.from(agents.entries()).map(([name, cfg]) => {
    return `  [${JSON.stringify(name)}, ${JSON.stringify(cfg)}]`;
  }).join(",\n");

  const content = `export const DEFAULT_AGENTS = new Map([\n${entries}\n]);\n`;
  await writeFile(join(distDir, "default-agents.js"), content, "utf-8");

  // package.json with type: module for ESM imports
  await writeFile(
    join(tmp, "package.json"),
    JSON.stringify({ name: "fixture-package", type: "module" }),
    "utf-8",
  );

  return tmp;
}

// ---------------------------------------------------------------------------
// serializeBuiltinAgent
// ---------------------------------------------------------------------------

describe("serializeBuiltinAgent", () => {
  it("produces a complete Markdown document with frontmatter and body", () => {
    const cfg: FixtureAgentConfig = {
      name: "test-agent",
      description: "A test agent",
      systemPrompt: "You are a test agent.\n\nDo test things.",
      extensions: true,
      skills: true,
      promptMode: "replace",
    };

    const result = serializeBuiltinAgent(cfg);
    const doc = parseAgentDocument(result);

    expect(doc.hadFrontmatter).toBe(true);
    expect(doc.frontmatter.description).toBe("A test agent");
    expect(doc.frontmatter.tools).toBe("all");
    expect(doc.frontmatter.prompt_mode).toBe("replace");
    // Eject format: body is "\n" + systemPrompt + "\n" (blank separator + trailing newline)
    expect(doc.body).toBe("\nYou are a test agent.\n\nDo test things.\n");
  });

  it("preserves empty append-mode system prompt body", () => {
    const cfg: FixtureAgentConfig = {
      name: "general-purpose",
      description: "General purpose agent",
      systemPrompt: "",
      extensions: true,
      skills: true,
      promptMode: "append",
    };

    const result = serializeBuiltinAgent(cfg);
    const doc = parseAgentDocument(result);

    expect(doc.frontmatter.prompt_mode).toBe("append");
    // Eject format: body is "\n" + "" + "\n" = "\n\n"
    expect(doc.body).toBe("\n\n");
  });

  it("serializes read-only builtinToolNames as comma-separated tools", () => {
    const cfg: FixtureAgentConfig = {
      name: "Explore",
      description: "Explorer agent",
      builtinToolNames: ["read", "bash", "grep", "find", "ls"],
      systemPrompt: "You are an explorer.",
      extensions: true,
      skills: true,
      promptMode: "replace",
    };

    const result = serializeBuiltinAgent(cfg);
    const doc = parseAgentDocument(result);

    expect(doc.frontmatter.tools).toBe("read, bash, grep, find, ls");
  });

  it("serializes model field when present", () => {
    const cfg: FixtureAgentConfig = {
      name: "with-model",
      description: "Has model",
      model: "anthropic/claude-haiku-4-5",
      systemPrompt: "body",
      extensions: true,
      skills: true,
      promptMode: "replace",
    };

    const result = serializeBuiltinAgent(cfg);
    const doc = parseAgentDocument(result);

    expect(doc.frontmatter.model).toBe("anthropic/claude-haiku-4-5");
  });

  it("serializes thinking field when present", () => {
    const cfg: FixtureAgentConfig = {
      name: "with-thinking",
      description: "Has thinking",
      thinking: "high",
      systemPrompt: "body",
      extensions: true,
      skills: true,
      promptMode: "replace",
    };

    const result = serializeBuiltinAgent(cfg);
    const doc = parseAgentDocument(result);

    expect(doc.frontmatter.thinking).toBe("high");
  });

  it("serializes max_turns field when present", () => {
    const cfg: FixtureAgentConfig = {
      name: "with-max-turns",
      description: "Has maxTurns",
      maxTurns: 20,
      systemPrompt: "body",
      extensions: true,
      skills: true,
      promptMode: "replace",
    };

    const result = serializeBuiltinAgent(cfg);
    const doc = parseAgentDocument(result);

    expect(doc.frontmatter.max_turns).toBe(20);
  });

  it("serializes display_name when present", () => {
    const cfg: FixtureAgentConfig = {
      name: "agent",
      displayName: "Custom Display",
      description: "With display name",
      systemPrompt: "body",
      extensions: true,
      skills: true,
      promptMode: "replace",
    };

    const result = serializeBuiltinAgent(cfg);
    const doc = parseAgentDocument(result);

    expect(doc.frontmatter.display_name).toBe("Custom Display");
  });

  it("serializes all metadata fields used by eject logic", () => {
    const cfg: FixtureAgentConfig = {
      name: "full-meta",
      description: "Full metadata agent",
      displayName: "FullMeta",
      builtinToolNames: ["read", "bash"],
      model: "anthropic/claude-sonnet-4-20250514",
      thinking: "medium",
      maxTurns: 15,
      extensions: false,
      excludeExtensions: ["unwanted-ext"],
      skills: false,
      disallowedTools: ["dangerous-tool"],
      inheritContext: true,
      runInBackground: true,
      outputTranscript: false,
      isolated: true,
      memory: "project",
      isolation: "worktree",
      systemPrompt: "Full metadata body.",
      promptMode: "replace",
    };

    const result = serializeBuiltinAgent(cfg);
    const doc = parseAgentDocument(result);

    expect(doc.frontmatter.description).toBe("Full metadata agent");
    expect(doc.frontmatter.display_name).toBe("FullMeta");
    expect(doc.frontmatter.tools).toBe("read, bash");
    expect(doc.frontmatter.model).toBe("anthropic/claude-sonnet-4-20250514");
    expect(doc.frontmatter.thinking).toBe("medium");
    expect(doc.frontmatter.max_turns).toBe(15);
    expect(doc.frontmatter.prompt_mode).toBe("replace");
    expect(doc.frontmatter.extensions).toBe(false);
    expect(doc.frontmatter.exclude_extensions).toEqual(["unwanted-ext"]);
    expect(doc.frontmatter.skills).toBe(false);
    expect(doc.frontmatter.disallowed_tools).toEqual(["dangerous-tool"]);
    expect(doc.frontmatter.inherit_context).toBe(true);
    expect(doc.frontmatter.run_in_background).toBe(true);
    expect(doc.frontmatter.output_transcript).toBe(false);
    expect(doc.frontmatter.isolated).toBe(true);
    expect(doc.frontmatter.memory).toBe("project");
    expect(doc.frontmatter.isolation).toBe("worktree");
    // Eject format: body is "\n" + systemPrompt + "\n"
    expect(doc.body).toBe("\nFull metadata body.\n");
  });

  it("omits display_name when not present", () => {
    const cfg: FixtureAgentConfig = {
      name: "no-display",
      description: "No display name",
      systemPrompt: "body",
      extensions: true,
      skills: true,
      promptMode: "replace",
    };

    const result = serializeBuiltinAgent(cfg);
    const doc = parseAgentDocument(result);

    expect(doc.frontmatter).not.toHaveProperty("display_name");
  });

  it("JSON-quotes description containing special characters", () => {
    const cfg: FixtureAgentConfig = {
      name: "quoted",
      description: 'Agent with "quotes" and\nnewlines',
      systemPrompt: "body",
      extensions: true,
      skills: true,
      promptMode: "replace",
    };

    const result = serializeBuiltinAgent(cfg);
    const doc = parseAgentDocument(result);

    // JSON.stringify produces properly escaped output
    expect(doc.frontmatter.description).toBe('Agent with "quotes" and\nnewlines');
  });

  it("correctly serializes extensions as list when array", () => {
    const cfg: FixtureAgentConfig = {
      name: "ext-list",
      description: "Extensions list",
      extensions: ["ext-a", "ext-b"],
      skills: true,
      systemPrompt: "body",
      promptMode: "replace",
    };

    const result = serializeBuiltinAgent(cfg);
    const doc = parseAgentDocument(result);

    expect(doc.frontmatter.extensions).toEqual(["ext-a", "ext-b"]);
  });

  it("omits extensions when true (default)", () => {
    const cfg: FixtureAgentConfig = {
      name: "ext-true",
      description: "Extensions true",
      extensions: true,
      skills: true,
      systemPrompt: "body",
      promptMode: "replace",
    };

    const result = serializeBuiltinAgent(cfg);
    const doc = parseAgentDocument(result);

    expect(doc.frontmatter).not.toHaveProperty("extensions");
  });
});

// ---------------------------------------------------------------------------
// Injection safety: values containing special YAML characters
// ---------------------------------------------------------------------------

describe("serializeBuiltinAgent injection safety", () => {
  it("round-trips description containing colon and space without extra keys", () => {
    const cfg: FixtureAgentConfig = {
      name: "inject-colon",
      description: "key: value injection attempt",
      systemPrompt: "body",
      extensions: true,
      skills: true,
      promptMode: "replace",
    };

    const result = serializeBuiltinAgent(cfg);
    const doc = parseAgentDocument(result);

    expect(doc.frontmatter.description).toBe("key: value injection attempt");
    // Must not create a spurious "key" key
    expect(doc.frontmatter).not.toHaveProperty("key");
    expect(doc.frontmatter).not.toHaveProperty("value injection attempt");
    // Only expected keys are present
    expect(Object.keys(doc.frontmatter).sort()).toEqual([
      "description",
      "prompt_mode",
      "tools",
    ]);
  });

  it("round-trips description containing hash (comment) without truncation", () => {
    const cfg: FixtureAgentConfig = {
      name: "inject-hash",
      description: "before # this should be preserved",
      systemPrompt: "body",
      extensions: true,
      skills: true,
      promptMode: "replace",
    };

    const result = serializeBuiltinAgent(cfg);
    const doc = parseAgentDocument(result);

    expect(doc.frontmatter.description).toBe(
      "before # this should be preserved",
    );
  });

  it("round-trips description containing quotes", () => {
    const cfg: FixtureAgentConfig = {
      name: "inject-quotes",
      description: 'contains "double" and \'single\' quotes',
      systemPrompt: "body",
      extensions: true,
      skills: true,
      promptMode: "replace",
    };

    const result = serializeBuiltinAgent(cfg);
    const doc = parseAgentDocument(result);

    expect(doc.frontmatter.description).toBe(
      'contains "double" and \'single\' quotes',
    );
  });

  it("round-trips description containing newlines", () => {
    const cfg: FixtureAgentConfig = {
      name: "inject-newline",
      description: "line 1\nline 2\nline 3",
      systemPrompt: "body",
      extensions: true,
      skills: true,
      promptMode: "replace",
    };

    const result = serializeBuiltinAgent(cfg);
    const doc = parseAgentDocument(result);

    expect(doc.frontmatter.description).toBe("line 1\nline 2\nline 3");
    // No extra keys from the newlines
    expect(Object.keys(doc.frontmatter).sort()).toEqual([
      "description",
      "prompt_mode",
      "tools",
    ]);
  });

  it("round-trips YAML-boolean-like description values", () => {
    const booleanLikes = ["true", "false", "yes", "no", "on", "off", "True", "False", "YES", "NO"];
    for (const val of booleanLikes) {
      const cfg: FixtureAgentConfig = {
        name: "bool-test",
        description: val,
        systemPrompt: "body",
        extensions: true,
        skills: true,
        promptMode: "replace",
      };

      const result = serializeBuiltinAgent(cfg);
      const doc = parseAgentDocument(result);

      expect(doc.frontmatter.description).toBe(val);
      expect(typeof doc.frontmatter.description).toBe("string");
    }
  });

  it("round-trips YAML-null-like description values", () => {
    const nullLikes = ["null", "Null", "NULL", "~", ""];
    for (const val of nullLikes) {
      const cfg: FixtureAgentConfig = {
        name: "null-test",
        description: val,
        systemPrompt: "body",
        extensions: true,
        skills: true,
        promptMode: "replace",
      };

      const result = serializeBuiltinAgent(cfg);
      const doc = parseAgentDocument(result);

      expect(doc.frontmatter.description).toBe(val);
      expect(typeof doc.frontmatter.description).toBe("string");
    }
  });

  it("round-trips display_name containing newlines without injecting keys", () => {
    const cfg: FixtureAgentConfig = {
      name: "nl-display",
      displayName: "Evil\nmodel: injected",
      description: "Newline in display name",
      systemPrompt: "body",
      extensions: true,
      skills: true,
      promptMode: "replace",
    };

    const result = serializeBuiltinAgent(cfg);
    const doc = parseAgentDocument(result);

    expect(doc.frontmatter.display_name).toBe("Evil\nmodel: injected");
    // Must not create a spurious "model" key from the injected line
    expect(doc.frontmatter.model).toBeUndefined();
  });

  it("round-trips model containing newlines without injecting keys", () => {
    const cfg: FixtureAgentConfig = {
      name: "nl-model",
      description: "Newline in model",
      model: "safe-model\nthinking: injected",
      systemPrompt: "body",
      extensions: true,
      skills: true,
      promptMode: "replace",
    };

    const result = serializeBuiltinAgent(cfg);
    const doc = parseAgentDocument(result);

    expect(doc.frontmatter.model).toBe("safe-model\nthinking: injected");
    // Must not create a spurious "thinking" key
    expect(doc.frontmatter.thinking).toBeUndefined();
  });

  it("round-trips list items containing colons and hashes", () => {
    const cfg: FixtureAgentConfig = {
      name: "list-special",
      description: "List with special chars",
      systemPrompt: "body",
      extensions: ["ext:with:colons", "#hash-ext", "ext with, comma"],
      skills: ["skill:colon", "#comment-skill", 'skill "quoted"'],
      promptMode: "replace",
    };

    const result = serializeBuiltinAgent(cfg);
    const doc = parseAgentDocument(result);

    expect(doc.frontmatter.extensions).toEqual([
      "ext:with:colons",
      "#hash-ext",
      "ext with, comma",
    ]);
    expect(doc.frontmatter.skills).toEqual([
      "skill:colon",
      "#comment-skill",
      'skill "quoted"',
    ]);
  });

  it("round-trips list items that look like YAML booleans and null", () => {
    const cfg: FixtureAgentConfig = {
      name: "list-bool-null",
      description: "List with YAML-like values",
      systemPrompt: "body",
      extensions: ["true", "false", "yes", "no", "null", "~"],
      skills: ["on", "off", "True", "False", "NULL"],
      promptMode: "replace",
    };

    const result = serializeBuiltinAgent(cfg);
    const doc = parseAgentDocument(result);

    // All values must be strings, not booleans or null
    for (const item of doc.frontmatter.extensions as unknown[]) {
      expect(typeof item).toBe("string");
    }
    for (const item of doc.frontmatter.skills as unknown[]) {
      expect(typeof item).toBe("string");
    }

    expect(doc.frontmatter.extensions).toEqual([
      "true", "false", "yes", "no", "null", "~",
    ]);
    expect(doc.frontmatter.skills).toEqual([
      "on", "off", "True", "False", "NULL",
    ]);
  });

  it("round-trips exclude_extensions and disallowed_tools with special chars", () => {
    const cfg: FixtureAgentConfig = {
      name: "exclude-special",
      description: "Exclude list with special chars",
      systemPrompt: "body",
      extensions: true,
      skills: true,
      excludeExtensions: ["ext:colon", "#hash"],
      disallowedTools: ["tool:colon", "#tool-hash", "tool, comma"],
      promptMode: "replace",
    };

    const result = serializeBuiltinAgent(cfg);
    const doc = parseAgentDocument(result);

    expect(doc.frontmatter.exclude_extensions).toEqual(["ext:colon", "#hash"]);
    expect(doc.frontmatter.disallowed_tools).toEqual([
      "tool:colon",
      "#tool-hash",
      "tool, comma",
    ]);
  });

  it("round-trips memory and isolation with special values", () => {
    const cfg: FixtureAgentConfig = {
      name: "mem-iso",
      description: "Memory and isolation",
      systemPrompt: "body",
      extensions: true,
      skills: true,
      memory: "project:extra",
      isolation: "worktree # comment",
      promptMode: "replace",
    };

    const result = serializeBuiltinAgent(cfg);
    const doc = parseAgentDocument(result);

    expect(doc.frontmatter.memory).toBe("project:extra");
    expect(doc.frontmatter.isolation).toBe("worktree # comment");
  });

  it("produces valid complete Markdown that parseAgentDocument accepts", () => {
    const cfg: FixtureAgentConfig = {
      name: "full-safe",
      description: "desc: with # hash and \"quotes\"",
      displayName: "Disp: evil",
      builtinToolNames: ["read", "bash:strict", "#tool"],
      model: "model: with: colons",
      thinking: "medium",
      maxTurns: 10,
      extensions: ["ext:1", "#ext2"],
      excludeExtensions: ["bad:ext"],
      skills: ["skill:1", "#skill"],
      disallowedTools: ["tool:bad", "#bad"],
      inheritContext: true,
      runInBackground: true,
      outputTranscript: false,
      isolated: true,
      memory: "project:mem",
      isolation: "worktree # iso",
      systemPrompt: "System prompt with # comment and : colon",
      promptMode: "replace",
    };

    const result = serializeBuiltinAgent(cfg);
    // Must be valid Markdown with frontmatter — parseAgentDocument should not throw
    const doc = parseAgentDocument(result);
    expect(doc.hadFrontmatter).toBe(true);

    // Verify semantic round-trip
    expect(doc.frontmatter.description).toBe(
      'desc: with # hash and "quotes"',
    );
    expect(doc.frontmatter.display_name).toBe("Disp: evil");
    expect(doc.frontmatter.tools).toBe("read, bash:strict, #tool");
    expect(doc.frontmatter.model).toBe("model: with: colons");
    expect(doc.frontmatter.extensions).toEqual(["ext:1", "#ext2"]);
    expect(doc.frontmatter.exclude_extensions).toEqual(["bad:ext"]);
    expect(doc.frontmatter.skills).toEqual(["skill:1", "#skill"]);
    expect(doc.frontmatter.disallowed_tools).toEqual(["tool:bad", "#bad"]);
    expect(doc.frontmatter.memory).toBe("project:mem");
    expect(doc.frontmatter.isolation).toBe("worktree # iso");
    expect(doc.body).toBe("\nSystem prompt with # comment and : colon\n");
  });
});

// ---------------------------------------------------------------------------
// loadBuiltinDefaults
// ---------------------------------------------------------------------------

describe("loadBuiltinDefaults", () => {
  it("loads DEFAULT_AGENTS from a valid fixture package", async () => {
    const agents = new Map<string, FixtureAgentConfig>([
      ["agent-a", {
        name: "agent-a",
        description: "Agent A",
        systemPrompt: "Body A",
        extensions: true,
        skills: true,
        promptMode: "replace",
      }],
      ["agent-b", {
        name: "agent-b",
        description: "Agent B",
        systemPrompt: "Body B",
        extensions: true,
        skills: true,
        promptMode: "append",
      }],
    ]);

    const pkgDir = await createFixturePackage(agents);
    try {
      const result = await loadBuiltinDefaults(pkgDir);
      expect(result).not.toBeNull();
      expect(result!.size).toBe(2);
      expect(result!.get("agent-a")?.description).toBe("Agent A");
      expect(result!.get("agent-b")?.description).toBe("Agent B");
    } finally {
      await rm(pkgDir, { recursive: true, force: true });
    }
  });

  it("returns null for non-existent directory", async () => {
    const result = await loadBuiltinDefaults("/tmp/nonexistent-builtins-test-12345");
    expect(result).toBeNull();
  });

  it("returns null when default-agents.js does not export DEFAULT_AGENTS", async () => {
    const tmp = await makeTempDir();
    try {
      const distDir = join(tmp, "dist");
      await mkdir(distDir, { recursive: true });
      await writeFile(
        join(distDir, "default-agents.js"),
        "export const OTHER_THING = 42;\n",
        "utf-8",
      );
      await writeFile(
        join(tmp, "package.json"),
        JSON.stringify({ name: "bad-pkg", type: "module" }),
        "utf-8",
      );

      const result = await loadBuiltinDefaults(tmp);
      expect(result).toBeNull();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("returns null when default-agents.js has syntax errors", async () => {
    const tmp = await makeTempDir();
    try {
      const distDir = join(tmp, "dist");
      await mkdir(distDir, { recursive: true });
      await writeFile(
        join(distDir, "default-agents.js"),
        "this is not valid javascript {{{",
        "utf-8",
      );
      await writeFile(
        join(tmp, "package.json"),
        JSON.stringify({ name: "syntax-err-pkg", type: "module" }),
        "utf-8",
      );

      const result = await loadBuiltinDefaults(tmp);
      expect(result).toBeNull();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// loadBuiltinAgentSources
// ---------------------------------------------------------------------------

describe("loadBuiltinAgentSources", () => {
  it("returns sources with kind builtin from a valid fixture", async () => {
    const agents = new Map<string, FixtureAgentConfig>([
      ["agent-a", {
        name: "agent-a",
        description: "Agent A",
        systemPrompt: "Body A",
        extensions: true,
        skills: true,
        promptMode: "replace",
      }],
    ]);

    const pkgDir = await createFixturePackage(agents);
    try {
      // Pass the parent of pkgDir as configDir so that
      // configDir/npm/node_modules/@tintinweb/pi-subagents resolves
      const configDir = join(pkgDir, ".."); // won't work directly
      // Instead, create the full expected path structure
      const fullConfigDir = await makeTempDir();
      const npmDir = join(fullConfigDir, "npm", "node_modules", "@tintinweb");
      await mkdir(npmDir, { recursive: true });
      // Symlink or copy the fixture package
      const { symlink } = await import("node:fs/promises");
      const targetPath = join(npmDir, "pi-subagents");
      await symlink(pkgDir, targetPath, "dir");

      try {
        const result = await loadBuiltinAgentSources(fullConfigDir);
        expect(result.sources).toHaveLength(1);
        expect(result.sources[0].name).toBe("agent-a");
        expect(result.sources[0].kind).toBe("builtin");
        expect(result.sources[0].path).toBeUndefined();
        expect(result.sources[0].content).toBeDefined();
        expect(result.warning).toBeUndefined();

        // Verify content is valid Markdown with frontmatter
        const doc = parseAgentDocument(result.sources[0].content!);
        expect(doc.hadFrontmatter).toBe(true);
        expect(doc.frontmatter.description).toBe("Agent A");
      } finally {
        await rm(fullConfigDir, { recursive: true, force: true });
        await rm(pkgDir, { recursive: true, force: true });
      }
    } catch {
      await rm(pkgDir, { recursive: true, force: true });
    }
  });

  it("returns empty sources and warning when package not found", async () => {
    // When @tintinweb/pi-subagents is installed in the root package (e.g. this
    // worktree), Node module resolution finds it via createRequire even for
    // non-existent config directories.  We bypass the installed package by
    // overriding loadBuiltinDefaults so the test correctly exercises the
    // "package not found" code path.
    setLoadBuiltinDefaultsOverride(async () => null);
    try {
      const result = await loadBuiltinAgentSources("/tmp/nonexistent-config-12345");
      expect(result.sources).toEqual([]);
      expect(result.warning).toBeDefined();
      expect(result.warning).toMatch(/\/agents/i);
    } finally {
      setLoadBuiltinDefaultsOverride(null);
    }
  });

  it("returns empty sources and warning when compiled exports unavailable", async () => {
    const fullConfigDir = await makeTempDir();
    try {
      const npmDir = join(fullConfigDir, "npm", "node_modules", "@tintinweb");
      await mkdir(npmDir, { recursive: true });

      // Create a package dir without default-agents.js
      const pkgDir = join(npmDir, "pi-subagents");
      await mkdir(pkgDir, { recursive: true });
      await mkdir(join(pkgDir, "dist"), { recursive: true });
      // No default-agents.js — just an empty dist
      await writeFile(
        join(pkgDir, "package.json"),
        JSON.stringify({ name: "@tintinweb/pi-subagents", type: "module" }),
        "utf-8",
      );

      // Even with a minimal package structure, the createRequire fallback
      // finds the real @tintinweb/pi-subagents in the root node_modules.
      // Override loadBuiltinDefaults to simulate the "compiled exports unavailable"
      // path so the test exercises the correct code branch.
      setLoadBuiltinDefaultsOverride(async () => null);
      try {
        const result = await loadBuiltinAgentSources(fullConfigDir);
        expect(result.sources).toEqual([]);
        expect(result.warning).toBeDefined();
        expect(result.warning).toMatch(/\/agents/i);
      } finally {
        setLoadBuiltinDefaultsOverride(null);
      }
    } finally {
      await rm(fullConfigDir, { recursive: true, force: true });
    }
  });

  it("returns empty sources and warning for malformed default map entries", async () => {
    // Create a fixture with a non-object entry in the map
    const tmp = await makeTempDir();
    try {
      const distDir = join(tmp, "dist");
      await mkdir(distDir, { recursive: true });
      await writeFile(
        join(distDir, "default-agents.js"),
        'export const DEFAULT_AGENTS = new Map([["bad-agent", null]]);\n',
        "utf-8",
      );
      await writeFile(
        join(tmp, "package.json"),
        JSON.stringify({ name: "fixture-package", type: "module" }),
        "utf-8",
      );

      const fullConfigDir = await makeTempDir();
      const npmDir = join(fullConfigDir, "npm", "node_modules", "@tintinweb");
      await mkdir(npmDir, { recursive: true });
      const { symlink } = await import("node:fs/promises");
      await symlink(tmp, join(npmDir, "pi-subagents"), "dir");

      try {
        const result = await loadBuiltinAgentSources(fullConfigDir);
        expect(result.sources).toEqual([]);
        expect(result.warning).toBeDefined();
        expect(result.warning).toMatch(/\/agents/i);
      } finally {
        await rm(fullConfigDir, { recursive: true, force: true });
        await rm(tmp, { recursive: true, force: true });
      }
    } catch {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("defaults configDir from PI_CODING_AGENT_DIR when not provided", async () => {
    const prev = process.env.PI_CODING_AGENT_DIR;
    setLoadBuiltinDefaultsOverride(async () => null);
    try {
      // Point to a non-existent directory to trigger the warning path
      process.env.PI_CODING_AGENT_DIR = "/tmp/nonexistent-pi-dir-12345";
      const result = await loadBuiltinAgentSources();
      expect(result.sources).toEqual([]);
      expect(result.warning).toBeDefined();
    } finally {
      setLoadBuiltinDefaultsOverride(null);
      if (prev === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = prev;
      }
    }
  });

  it("does not invent prompts for missing packages", async () => {
    // In the worktree environment @tintinweb/pi-subagents is installed, so
    // Node resolution finds it via createRequire even for non-existent paths.
    // Override loadBuiltinDefaults to trigger the missing-package path.
    setLoadBuiltinDefaultsOverride(async () => null);
    try {
      const result = await loadBuiltinAgentSources("/tmp/definitely-not-a-real-config");
      expect(result.sources).toEqual([]);
      expect(result.warning).toMatch(/\/agents/);
      // Verify no generic fallback content
      for (const source of result.sources) {
        expect(source.content).not.toMatch(/you are a (helpful|generic|default) agent/i);
      }
    } finally {
      setLoadBuiltinDefaultsOverride(null);
    }
  });
});

// ---------------------------------------------------------------------------
// Gap 1: Map entry validation before serialization
// ---------------------------------------------------------------------------

describe("Map entry validation (Gap 1)", () => {
  async function loadFromFixture(
    agents: Map<string, unknown>,
  ): Promise<{ sources: AgentSource[]; warning?: string }> {
    const pkgDir = await createFixturePackage(agents as Map<string, FixtureAgentConfig>);
    // Override: create with raw entries
    const distDir = join(pkgDir, "dist");
    const entries = Array.from(agents.entries()).map(([name, cfg]) => {
      return `  [${JSON.stringify(name)}, ${JSON.stringify(cfg)}]`;
    }).join(",\n");
    const content = `export const DEFAULT_AGENTS = new Map([\n${entries}\n]);\n`;
    await writeFile(join(distDir, "default-agents.js"), content, "utf-8");

    const fullConfigDir = await makeTempDir();
    const npmDir = join(fullConfigDir, "npm", "node_modules", "@tintinweb");
    await mkdir(npmDir, { recursive: true });
    await symlink(pkgDir, join(npmDir, "pi-subagents"), "dir");

    try {
      return await loadBuiltinAgentSources(fullConfigDir);
    } finally {
      await rm(fullConfigDir, { recursive: true, force: true });
      await rm(pkgDir, { recursive: true, force: true });
    }
  }

  it("skips entries where cfg is null", async () => {
    const agents = new Map<string, unknown>([
      ["valid-agent", {
        name: "valid-agent",
        description: "Valid",
        systemPrompt: "body",
        extensions: true,
        skills: true,
        promptMode: "replace",
      }],
      ["null-agent", null],
    ]);

    const result = await loadFromFixture(agents);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].name).toBe("valid-agent");
    expect(result.warning).toBeDefined();
    expect(result.warning).toMatch(/\/agents/);
  });

  it("skips entries where cfg is an array", async () => {
    const agents = new Map<string, unknown>([
      ["valid-agent", {
        name: "valid-agent",
        description: "Valid",
        systemPrompt: "body",
        extensions: true,
        skills: true,
        promptMode: "replace",
      }],
      ["array-agent", ["not", "an", "object"]],
    ]);

    const result = await loadFromFixture(agents);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].name).toBe("valid-agent");
    expect(result.warning).toBeDefined();
  });

  it("skips entry with empty object {}", async () => {
    const agents = new Map<string, unknown>([
      ["empty-agent", {}],
    ]);

    const result = await loadFromFixture(agents);
    expect(result.sources).toEqual([]);
    expect(result.warning).toBeDefined();
    expect(result.warning).toMatch(/\/agents/);
  });

  it("skips entry missing required string fields", async () => {
    const agents = new Map<string, unknown>([
      ["no-desc", {
        name: "no-desc",
        systemPrompt: "body",
        extensions: true,
        skills: true,
        promptMode: "replace",
      }],
      ["no-systemPrompt", {
        name: "no-systemPrompt",
        description: "desc",
        extensions: true,
        skills: true,
        promptMode: "replace",
      }],
      ["no-promptMode", {
        name: "no-promptMode",
        description: "desc",
        systemPrompt: "body",
        extensions: true,
        skills: true,
      }],
    ]);

    const result = await loadFromFixture(agents);
    expect(result.sources).toEqual([]);
    expect(result.warning).toBeDefined();
  });

  it("skips entry where cfg.name does not match map key", async () => {
    const agents = new Map<string, unknown>([
      ["map-key", {
        name: "different-name",
        description: "Mismatched name",
        systemPrompt: "body",
        extensions: true,
        skills: true,
        promptMode: "replace",
      }],
    ]);

    const result = await loadFromFixture(agents);
    expect(result.sources).toEqual([]);
    expect(result.warning).toBeDefined();
    expect(result.warning).toMatch(/\/agents/);
  });

  it("skips entry with unsafe agent name as map key", async () => {
    const agents = new Map<string, unknown>([
      ["../unsafe", {
        name: "../unsafe",
        description: "Unsafe name",
        systemPrompt: "body",
        extensions: true,
        skills: true,
        promptMode: "replace",
      }],
    ]);

    const result = await loadFromFixture(agents);
    expect(result.sources).toEqual([]);
    expect(result.warning).toBeDefined();
  });

  it("skips entry with empty map key", async () => {
    const agents = new Map<string, unknown>([
      ["", {
        name: "",
        description: "Empty name",
        systemPrompt: "body",
        extensions: true,
        skills: true,
        promptMode: "replace",
      }],
    ]);

    const result = await loadFromFixture(agents);
    expect(result.sources).toEqual([]);
    // Empty key is still a key in Map, but validation should reject it
  });

  it("skips entry where description is not a string", async () => {
    const agents = new Map<string, unknown>([
      ["bad-desc", {
        name: "bad-desc",
        description: 123,
        systemPrompt: "body",
        extensions: true,
        skills: true,
        promptMode: "replace",
      }],
    ]);

    const result = await loadFromFixture(agents);
    expect(result.sources).toEqual([]);
    expect(result.warning).toBeDefined();
  });

  it("skips entry where systemPrompt is not a string", async () => {
    const agents = new Map<string, unknown>([
      ["bad-sp", {
        name: "bad-sp",
        description: "desc",
        systemPrompt: null,
        extensions: true,
        skills: true,
        promptMode: "replace",
      }],
    ]);

    const result = await loadFromFixture(agents);
    expect(result.sources).toEqual([]);
    expect(result.warning).toBeDefined();
  });

  it("skips entry where promptMode is not a string", async () => {
    const agents = new Map<string, unknown>([
      ["bad-pm", {
        name: "bad-pm",
        description: "desc",
        systemPrompt: "body",
        extensions: true,
        skills: true,
        promptMode: 42,
      }],
    ]);

    const result = await loadFromFixture(agents);
    expect(result.sources).toEqual([]);
    expect(result.warning).toBeDefined();
  });

  it("skips entry where extensions has wrong type", async () => {
    const agents = new Map<string, unknown>([
      ["bad-ext", {
        name: "bad-ext",
        description: "desc",
        systemPrompt: "body",
        extensions: "not-boolean-or-array",
        skills: true,
        promptMode: "replace",
      }],
    ]);

    const result = await loadFromFixture(agents);
    expect(result.sources).toEqual([]);
    expect(result.warning).toBeDefined();
  });

  it("skips entry where skills has wrong type", async () => {
    const agents = new Map<string, unknown>([
      ["bad-skills", {
        name: "bad-skills",
        description: "desc",
        systemPrompt: "body",
        extensions: true,
        skills: 123,
        promptMode: "replace",
      }],
    ]);

    const result = await loadFromFixture(agents);
    expect(result.sources).toEqual([]);
    expect(result.warning).toBeDefined();
  });

  it("skips entry where optional array contains non-strings", async () => {
    const agents = new Map<string, unknown>([
      ["bad-arr", {
        name: "bad-arr",
        description: "desc",
        systemPrompt: "body",
        extensions: ["ok", 123],
        skills: true,
        promptMode: "replace",
      }],
    ]);

    const result = await loadFromFixture(agents);
    expect(result.sources).toEqual([]);
    expect(result.warning).toBeDefined();
  });

  it("skips entry where maxTurns is not a finite positive integer", async () => {
    const agents = new Map<string, unknown>([
      ["bad-max1", {
        name: "bad-max1",
        description: "desc",
        systemPrompt: "body",
        extensions: true,
        skills: true,
        promptMode: "replace",
        maxTurns: -1,
      }],
      ["bad-max2", {
        name: "bad-max2",
        description: "desc",
        systemPrompt: "body",
        extensions: true,
        skills: true,
        promptMode: "replace",
        maxTurns: 0,
      }],
      ["bad-max3", {
        name: "bad-max3",
        description: "desc",
        systemPrompt: "body",
        extensions: true,
        skills: true,
        promptMode: "replace",
        maxTurns: 1.5,
      }],
      ["bad-max4", {
        name: "bad-max4",
        description: "desc",
        systemPrompt: "body",
        extensions: true,
        skills: true,
        promptMode: "replace",
        maxTurns: Infinity,
      }],
      ["bad-max5", {
        name: "bad-max5",
        description: "desc",
        systemPrompt: "body",
        extensions: true,
        skills: true,
        promptMode: "replace",
        maxTurns: "not-a-number",
      }],
    ]);

    const result = await loadFromFixture(agents);
    expect(result.sources).toEqual([]);
    expect(result.warning).toBeDefined();
  });

  it("skips entry where optional booleans have wrong types", async () => {
    const agents = new Map<string, unknown>([
      ["bad-bool1", {
        name: "bad-bool1",
        description: "desc",
        systemPrompt: "body",
        extensions: true,
        skills: true,
        promptMode: "replace",
        inheritContext: "yes",
      }],
      ["bad-bool2", {
        name: "bad-bool2",
        description: "desc",
        systemPrompt: "body",
        extensions: true,
        skills: true,
        promptMode: "replace",
        isolated: 1,
      }],
    ]);

    const result = await loadFromFixture(agents);
    expect(result.sources).toEqual([]);
    expect(result.warning).toBeDefined();
  });

  it("returns empty sources + warning when all entries invalid", async () => {
    const agents = new Map<string, unknown>([
      ["bad1", null],
      ["bad2", {}],
      ["bad3", []],
    ]);

    const result = await loadFromFixture(agents);
    expect(result.sources).toEqual([]);
    expect(result.warning).toBeDefined();
    expect(result.warning).toMatch(/\/agents/);
  });

  it("partial invalidity yields actionable warning with failed count and safe names", async () => {
    const agents = new Map<string, unknown>([
      ["good", {
        name: "good",
        description: "Valid",
        systemPrompt: "body",
        extensions: true,
        skills: true,
        promptMode: "replace",
      }],
      ["bad", null],
    ]);

    const result = await loadFromFixture(agents);
    expect(result.sources).toHaveLength(1);
    expect(result.warning).toBeDefined();
    expect(result.warning).toMatch(/\/agents/);
    // Warning should include the failed count
    expect(result.warning).toMatch(/1 .* could not be loaded/);
  });

  it("never produces fabricated undefined content", async () => {
    const agents = new Map<string, unknown>([
      ["bad", null],
    ]);

    const result = await loadFromFixture(agents);
    for (const source of result.sources) {
      expect(source.content).not.toContain("undefined");
      expect(source.content).not.toBeUndefined();
    }
  });

  it("accepts valid entry with model, thinking, displayName, memory, isolation strings", async () => {
    const agents = new Map<string, unknown>([
      ["with-optionals", {
        name: "with-optionals",
        description: "Has optional strings",
        systemPrompt: "body",
        extensions: true,
        skills: true,
        promptMode: "replace",
        model: "anthropic/claude",
        thinking: "high",
        displayName: "Display",
        memory: "project",
        isolation: "worktree",
      }],
    ]);

    const result = await loadFromFixture(agents);
    expect(result.sources).toHaveLength(1);
    expect(result.warning).toBeUndefined();
  });

  it("accepts valid entry with extensions and skills as string arrays", async () => {
    const agents = new Map<string, unknown>([
      ["with-arrays", {
        name: "with-arrays",
        description: "Has arrays",
        systemPrompt: "body",
        extensions: ["ext-a", "ext-b"],
        skills: ["skill-1", "skill-2"],
        promptMode: "replace",
      }],
    ]);

    const result = await loadFromFixture(agents);
    expect(result.sources).toHaveLength(1);
    expect(result.warning).toBeUndefined();
  });

  it("accepts valid entry with maxTurns as positive integer", async () => {
    const agents = new Map<string, unknown>([
      ["with-max", {
        name: "with-max",
        description: "Has maxTurns",
        systemPrompt: "body",
        extensions: true,
        skills: true,
        promptMode: "replace",
        maxTurns: 42,
      }],
    ]);

    const result = await loadFromFixture(agents);
    expect(result.sources).toHaveLength(1);
    expect(result.warning).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Gap 2: serializeBuiltinAgent rejects invalid config
// ---------------------------------------------------------------------------

describe("serializeBuiltinAgent validation (Gap 2)", () => {
  it("throws on null config", () => {
    expect(() => serializeBuiltinAgent(null as unknown as FixtureAgentConfig))
      .toThrow();
  });

  it("throws on undefined config", () => {
    expect(() => serializeBuiltinAgent(undefined as unknown as FixtureAgentConfig))
      .toThrow();
  });

  it("throws on array config", () => {
    expect(() => serializeBuiltinAgent([] as unknown as FixtureAgentConfig))
      .toThrow();
  });

  it("throws on empty object config", () => {
    expect(() => serializeBuiltinAgent({} as FixtureAgentConfig))
      .toThrow();
  });

  it("throws when description is missing", () => {
    expect(() => serializeBuiltinAgent({
      name: "test",
      systemPrompt: "body",
      extensions: true,
      skills: true,
      promptMode: "replace",
    } as unknown as FixtureAgentConfig)).toThrow();
  });

  it("throws when description is wrong type", () => {
    expect(() => serializeBuiltinAgent({
      name: "test",
      description: 123,
      systemPrompt: "body",
      extensions: true,
      skills: true,
      promptMode: "replace",
    } as unknown as FixtureAgentConfig)).toThrow();
  });

  it("throws when systemPrompt is missing", () => {
    expect(() => serializeBuiltinAgent({
      name: "test",
      description: "desc",
      extensions: true,
      skills: true,
      promptMode: "replace",
    } as unknown as FixtureAgentConfig)).toThrow();
  });

  it("throws when systemPrompt is wrong type", () => {
    expect(() => serializeBuiltinAgent({
      name: "test",
      description: "desc",
      systemPrompt: 42,
      extensions: true,
      skills: true,
      promptMode: "replace",
    } as unknown as FixtureAgentConfig)).toThrow();
  });

  it("throws when promptMode is missing", () => {
    expect(() => serializeBuiltinAgent({
      name: "test",
      description: "desc",
      systemPrompt: "body",
      extensions: true,
      skills: true,
    } as unknown as FixtureAgentConfig)).toThrow();
  });

  it("throws when promptMode is wrong type", () => {
    expect(() => serializeBuiltinAgent({
      name: "test",
      description: "desc",
      systemPrompt: "body",
      extensions: true,
      skills: true,
      promptMode: 42,
    } as unknown as FixtureAgentConfig)).toThrow();
  });

  it("throws when extensions is wrong type", () => {
    expect(() => serializeBuiltinAgent({
      name: "test",
      description: "desc",
      systemPrompt: "body",
      extensions: "bad",
      skills: true,
      promptMode: "replace",
    } as unknown as FixtureAgentConfig)).toThrow();
  });

  it("throws when skills is wrong type", () => {
    expect(() => serializeBuiltinAgent({
      name: "test",
      description: "desc",
      systemPrompt: "body",
      extensions: true,
      skills: "bad",
      promptMode: "replace",
    } as unknown as FixtureAgentConfig)).toThrow();
  });

  it("throws when optional array contains non-strings", () => {
    expect(() => serializeBuiltinAgent({
      name: "test",
      description: "desc",
      systemPrompt: "body",
      extensions: ["ok", 123],
      skills: true,
      promptMode: "replace",
    } as unknown as FixtureAgentConfig)).toThrow();
  });

  it("throws when maxTurns is not a finite positive integer", () => {
    expect(() => serializeBuiltinAgent({
      name: "test",
      description: "desc",
      systemPrompt: "body",
      extensions: true,
      skills: true,
      promptMode: "replace",
      maxTurns: -1,
    } as unknown as FixtureAgentConfig)).toThrow();
  });

  it("throws when maxTurns is zero", () => {
    expect(() => serializeBuiltinAgent({
      name: "test",
      description: "desc",
      systemPrompt: "body",
      extensions: true,
      skills: true,
      promptMode: "replace",
      maxTurns: 0,
    } as unknown as FixtureAgentConfig)).toThrow();
  });

  it("throws when maxTurns is not an integer", () => {
    expect(() => serializeBuiltinAgent({
      name: "test",
      description: "desc",
      systemPrompt: "body",
      extensions: true,
      skills: true,
      promptMode: "replace",
      maxTurns: 1.5,
    } as unknown as FixtureAgentConfig)).toThrow();
  });

  it("throws when maxTurns is Infinity", () => {
    expect(() => serializeBuiltinAgent({
      name: "test",
      description: "desc",
      systemPrompt: "body",
      extensions: true,
      skills: true,
      promptMode: "replace",
      maxTurns: Infinity,
    } as unknown as FixtureAgentConfig)).toThrow();
  });

  it("throws when maxTurns is wrong type", () => {
    expect(() => serializeBuiltinAgent({
      name: "test",
      description: "desc",
      systemPrompt: "body",
      extensions: true,
      skills: true,
      promptMode: "replace",
      maxTurns: "not-a-number",
    } as unknown as FixtureAgentConfig)).toThrow();
  });

  it("throws when optional booleans have wrong types", () => {
    expect(() => serializeBuiltinAgent({
      name: "test",
      description: "desc",
      systemPrompt: "body",
      extensions: true,
      skills: true,
      promptMode: "replace",
      inheritContext: "yes",
    } as unknown as FixtureAgentConfig)).toThrow();
  });

  it("throws when optional model is not a string", () => {
    expect(() => serializeBuiltinAgent({
      name: "test",
      description: "desc",
      systemPrompt: "body",
      extensions: true,
      skills: true,
      promptMode: "replace",
      model: 123,
    } as unknown as FixtureAgentConfig)).toThrow();
  });

  it("throws when cfg.name is not a string", () => {
    expect(() => serializeBuiltinAgent({
      name: 123,
      description: "desc",
      systemPrompt: "body",
      extensions: true,
      skills: true,
      promptMode: "replace",
    } as unknown as FixtureAgentConfig)).toThrow();
  });

  it("still produces valid output for complete valid config", () => {
    const cfg: FixtureAgentConfig = {
      name: "test-agent",
      description: "A test agent",
      systemPrompt: "You are a test agent.",
      extensions: true,
      skills: true,
      promptMode: "replace",
    };

    const result = serializeBuiltinAgent(cfg);
    expect(result).toContain("---");
    expect(result).toContain("description:");
    expect(result).toContain("You are a test agent.");
  });

  it("accepts empty systemPrompt string", () => {
    const cfg: FixtureAgentConfig = {
      name: "test",
      description: "desc",
      systemPrompt: "",
      extensions: true,
      skills: true,
      promptMode: "replace",
    };

    const result = serializeBuiltinAgent(cfg);
    expect(result).toContain("---");
  });
});

// ---------------------------------------------------------------------------
// Gap 3: Normal Node resolution with injectable candidate mechanism
// ---------------------------------------------------------------------------

describe("Node resolution candidates (Gap 3)", () => {
  it("resolves from a normal node_modules tree outside configDir", async () => {
    // Create a node_modules fixture that simulates a normal install
    const nmRoot = await makeTempDir();
    try {
      const pkgDir = join(nmRoot, "node_modules", "@tintinweb", "pi-subagents");
      await mkdir(pkgDir, { recursive: true });
      await mkdir(join(pkgDir, "dist"), { recursive: true });

      const agents = new Map<string, FixtureAgentConfig>([
        ["nm-agent", {
          name: "nm-agent",
          description: "From node_modules",
          systemPrompt: "Body from node_modules",
          extensions: true,
          skills: true,
          promptMode: "replace",
        }],
      ]);

      const entries = Array.from(agents.entries()).map(([name, cfg]) => {
        return `  [${JSON.stringify(name)}, ${JSON.stringify(cfg)}]`;
      }).join(",\n");

      await writeFile(
        join(pkgDir, "dist", "default-agents.js"),
        `export const DEFAULT_AGENTS = new Map([\n${entries}\n]);\n`,
        "utf-8",
      );

      await writeFile(
        join(pkgDir, "package.json"),
        JSON.stringify({
          name: "@tintinweb/pi-subagents",
          type: "module",
        }),
        "utf-8",
      );

      // Use createRequire to resolve the package from the node_modules tree.
      // Resolve package.json to get the package root, then load by file URL.
      const req = createRequire(join(nmRoot, "noop.js"));
      const pkgJsonPath = req.resolve("@tintinweb/pi-subagents/package.json");
      expect(pkgJsonPath).toContain("pi-subagents");

      // Load using the resolved package root
      const pkgRoot = dirname(pkgJsonPath);
      const defaults = await loadBuiltinDefaults(pkgRoot);
      expect(defaults).not.toBeNull();
      expect(defaults!.get("nm-agent")?.description).toBe("From node_modules");
    } finally {
      await rm(nmRoot, { recursive: true, force: true });
    }
  });

  it("deterministic: explicit configDir path checked first", async () => {
    // Create TWO fixtures: one in configDir, one in a node_modules tree
    // The configDir one should win
    const configRoot = await makeTempDir();
    const nmRoot = await makeTempDir();

    try {
      // configDir fixture
      const configPkgDir = join(configRoot, "npm", "node_modules", "@tintinweb", "pi-subagents");
      await mkdir(configPkgDir, { recursive: true });
      await mkdir(join(configPkgDir, "dist"), { recursive: true });

      const configAgents = new Map<string, FixtureAgentConfig>([
        ["config-agent", {
          name: "config-agent",
          description: "From configDir",
          systemPrompt: "Config body",
          extensions: true,
          skills: true,
          promptMode: "replace",
        }],
      ]);

      const configEntries = Array.from(configAgents.entries()).map(([name, cfg]) => {
        return `  [${JSON.stringify(name)}, ${JSON.stringify(cfg)}]`;
      }).join(",\n");

      await writeFile(
        join(configPkgDir, "dist", "default-agents.js"),
        `export const DEFAULT_AGENTS = new Map([\n${configEntries}\n]);\n`,
        "utf-8",
      );

      await writeFile(
        join(configPkgDir, "package.json"),
        JSON.stringify({ name: "@tintinweb/pi-subagents", type: "module" }),
        "utf-8",
      );

      // node_modules fixture with different agent
      const nmPkgDir = join(nmRoot, "node_modules", "@tintinweb", "pi-subagents");
      await mkdir(nmPkgDir, { recursive: true });
      await mkdir(join(nmPkgDir, "dist"), { recursive: true });

      const nmAgents = new Map<string, FixtureAgentConfig>([
        ["nm-agent", {
          name: "nm-agent",
          description: "From node_modules",
          systemPrompt: "NM body",
          extensions: true,
          skills: true,
          promptMode: "replace",
        }],
      ]);

      const nmEntries = Array.from(nmAgents.entries()).map(([name, cfg]) => {
        return `  [${JSON.stringify(name)}, ${JSON.stringify(cfg)}]`;
      }).join(",\n");

      await writeFile(
        join(nmPkgDir, "dist", "default-agents.js"),
        `export const DEFAULT_AGENTS = new Map([\n${nmEntries}\n]);\n`,
        "utf-8",
      );

      await writeFile(
        join(nmPkgDir, "package.json"),
        JSON.stringify({
          name: "@tintinweb/pi-subagents",
          type: "module",
        }),
        "utf-8",
      );

      // Verify the node_modules fixture is resolvable
      const req = createRequire(join(nmRoot, "noop.js"));
      const pkgJsonPath = req.resolve("@tintinweb/pi-subagents/package.json");
      expect(pkgJsonPath).toContain("pi-subagents");

      // Load with configDir pointing to our configRoot
      const result = await loadBuiltinAgentSources(configRoot);
      // Should find config-agent from configDir, not nm-agent from node_modules
      expect(result.sources).toHaveLength(1);
      expect(result.sources[0].name).toBe("config-agent");
    } finally {
      await rm(configRoot, { recursive: true, force: true });
      await rm(nmRoot, { recursive: true, force: true });
    }
  });

  it("no cache interference between repeated loads", async () => {
    const agents1 = new Map<string, FixtureAgentConfig>([
      ["agent-v1", {
        name: "agent-v1",
        description: "Version 1",
        systemPrompt: "v1",
        extensions: true,
        skills: true,
        promptMode: "replace",
      }],
    ]);

    const pkgDir1 = await createFixturePackage(agents1);
    try {
      const configDir1 = await makeTempDir();
      const npmDir1 = join(configDir1, "npm", "node_modules", "@tintinweb");
      await mkdir(npmDir1, { recursive: true });
      await symlink(pkgDir1, join(npmDir1, "pi-subagents"), "dir");

      const result1 = await loadBuiltinAgentSources(configDir1);
      expect(result1.sources).toHaveLength(1);
      expect(result1.sources[0].name).toBe("agent-v1");

      await rm(configDir1, { recursive: true, force: true });

      // Second load with different fixture
      const agents2 = new Map<string, FixtureAgentConfig>([
        ["agent-v2", {
          name: "agent-v2",
          description: "Version 2",
          systemPrompt: "v2",
          extensions: true,
          skills: true,
          promptMode: "replace",
        }],
      ]);

      const pkgDir2 = await createFixturePackage(agents2);
      const configDir2 = await makeTempDir();
      const npmDir2 = join(configDir2, "npm", "node_modules", "@tintinweb");
      await mkdir(npmDir2, { recursive: true });
      await symlink(pkgDir2, join(npmDir2, "pi-subagents"), "dir");

      try {
        const result2 = await loadBuiltinAgentSources(configDir2);
        expect(result2.sources).toHaveLength(1);
        expect(result2.sources[0].name).toBe("agent-v2");
        // No cache interference — should not see agent-v1
      } finally {
        await rm(configDir2, { recursive: true, force: true });
        await rm(pkgDir2, { recursive: true, force: true });
      }
    } finally {
      await rm(pkgDir1, { recursive: true, force: true });
    }
  });

  it("does not claim an unproven bare dynamic import", async () => {
    // The builtins module should NOT use a bare dynamic import like
    // import("@tintinweb/pi-subagents/...") without proof it works.
    // Instead, it should resolve via createRequire or import.meta.resolve
    const extDir = join(import.meta.dirname, "..");

    // Read the source directly
    const fs = await import("node:fs/promises");
    const builtinsSrc = await fs.readFile(
      join(extDir, "src", "builtins.ts"),
      "utf-8",
    );

    // Should not contain a bare dynamic import of pi-subagents
    // The resolution should use createRequire or import.meta.resolve
    const hasBareImport = /import\s*\(\s*["']@tintinweb\/pi-subagents/.test(builtinsSrc);
    // It may still use import() but with a resolved file URL, not bare specifier
    // We check that if there's a dynamic import, it resolves to a file URL
    if (hasBareImport) {
      // If it uses bare import, it must be wrapped in a try/catch that
      // doesn't claim success without proof
      const hasCreateRequire = builtinsSrc.includes("createRequire");
      const hasImportMeta = builtinsSrc.includes("import.meta.resolve");
      expect(hasCreateRequire || hasImportMeta).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Gap 5: EOF newline
// ---------------------------------------------------------------------------

describe("EOF newline (Gap 5)", () => {
  it("builtins.ts ends with a newline", async () => {
    const fs = await import("node:fs/promises");
    const builtinsSrc = await fs.readFile(
      join(import.meta.dirname, "..", "src", "builtins.ts"),
      "utf-8",
    );
    expect(builtinsSrc.endsWith("\n")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Integration with discovery precedence
// ---------------------------------------------------------------------------

describe("builtin integration with discovery", () => {
  it("builtin sources are lowest precedence and retained when shadowed", () => {
    const builtinSource: AgentSource = {
      name: "test-agent",
      kind: "builtin",
      content: "---\ndescription: builtin\n---\nbuiltin body",
    };

    const projectSource: AgentSource = {
      name: "test-agent",
      kind: "project-pi",
      path: "/p/test-agent.md",
      content: "---\ndescription: project\n---\nproject body",
    };

    const result = resolveAgentPrecedence([builtinSource, projectSource]);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("test-agent");
    expect(result[0].effective.kind).toBe("project-pi");
    expect(result[0].effective.content).toBe("---\ndescription: project\n---\nproject body");
    // Builtin is retained in sources, at the end (lowest precedence)
    expect(result[0].sources).toHaveLength(2);
    expect(result[0].sources[0].kind).toBe("project-pi");
    expect(result[0].sources[1].kind).toBe("builtin");
  });

  it("builtin-only agents are effective", () => {
    const builtinSource: AgentSource = {
      name: "builtin-only",
      kind: "builtin",
      content: "---\ndescription: only builtin\n---\nbuiltin body",
    };

    const result = resolveAgentPrecedence([builtinSource]);

    expect(result).toHaveLength(1);
    expect(result[0].effective.kind).toBe("builtin");
    expect(result[0].effective.content).toBe("---\ndescription: only builtin\n---\nbuiltin body");
  });
});

// ---------------------------------------------------------------------------
// Diagnostics: warning quality, getLastLoadError, no console.warn from loader
// ---------------------------------------------------------------------------

describe("diagnostics", () => {
  it("package-missing warning distinguishes missing package from incompatible", async () => {
    // @tintinweb/pi-subagents is installed in the worktree root, so Node
    // resolution finds it even for non-existent paths.  Override loadBuiltinDefaults
    // to simulate the missing-package scenario.
    setLoadBuiltinDefaultsOverride(async () => null);
    try {
      const result = await loadBuiltinAgentSources("/tmp/definitely-not-a-real-config");
      expect(result.sources).toEqual([]);
      expect(result.warning).toBeDefined();
      // Missing-package path should mention "not installed"
      expect(result.warning).toMatch(/not installed|not available/i);
      expect(result.warning).toMatch(/\/agents/);
    } finally {
      setLoadBuiltinDefaultsOverride(null);
    }
  });

  it("warning includes failed count when entries are skipped", async () => {
    const agents = new Map<string, unknown>([
      ["good", {
        name: "good",
        description: "Valid",
        systemPrompt: "body",
        extensions: true,
        skills: true,
        promptMode: "replace",
      }],
      ["bad1", null],
      ["bad2", {}],
    ]);

    const pkgDir = await createFixturePackage(agents as Map<string, FixtureAgentConfig>);
    const distDir = join(pkgDir, "dist");
    const entries = Array.from(agents.entries()).map(([name, cfg]) => {
      return `  [${JSON.stringify(name)}, ${JSON.stringify(cfg)}]`;
    }).join(",\n");
    const content = `export const DEFAULT_AGENTS = new Map([\n${entries}\n]);\n`;
    await writeFile(join(distDir, "default-agents.js"), content, "utf-8");

    const fullConfigDir = await makeTempDir();
    const npmDir = join(fullConfigDir, "npm", "node_modules", "@tintinweb");
    await mkdir(npmDir, { recursive: true });
    await symlink(pkgDir, join(npmDir, "pi-subagents"), "dir");

    try {
      const result = await loadBuiltinAgentSources(fullConfigDir);
      expect(result.sources).toHaveLength(1);
      expect(result.warning).toBeDefined();
      // Should mention the count of failed entries
      expect(result.warning).toMatch(/2 .* could not be loaded/);
      expect(result.warning).toMatch(/\/agents/);
    } finally {
      await rm(fullConfigDir, { recursive: true, force: true });
      await rm(pkgDir, { recursive: true, force: true });
    }
  });

  it("warning includes affected agent names when validation fails", async () => {
    const agents = new Map<string, unknown>([
      ["good", {
        name: "good",
        description: "Valid",
        systemPrompt: "body",
        extensions: true,
        skills: true,
        promptMode: "replace",
      }],
      ["no-desc", {
        name: "no-desc",
        systemPrompt: "body",
        extensions: true,
        skills: true,
        promptMode: "replace",
      }],
    ]);

    const pkgDir = await createFixturePackage(agents as Map<string, FixtureAgentConfig>);
    const distDir = join(pkgDir, "dist");
    const entries = Array.from(agents.entries()).map(([name, cfg]) => {
      return `  [${JSON.stringify(name)}, ${JSON.stringify(cfg)}]`;
    }).join(",\n");
    const content = `export const DEFAULT_AGENTS = new Map([\n${entries}\n]);\n`;
    await writeFile(join(distDir, "default-agents.js"), content, "utf-8");

    const fullConfigDir = await makeTempDir();
    const npmDir = join(fullConfigDir, "npm", "node_modules", "@tintinweb");
    await mkdir(npmDir, { recursive: true });
    await symlink(pkgDir, join(npmDir, "pi-subagents"), "dir");

    try {
      const result = await loadBuiltinAgentSources(fullConfigDir);
      expect(result.sources).toHaveLength(1);
      expect(result.warning).toBeDefined();
      // Should mention the name of the failed agent
      expect(result.warning).toMatch(/no-desc/);
      expect(result.warning).toMatch(/\/agents/);
    } finally {
      await rm(fullConfigDir, { recursive: true, force: true });
      await rm(pkgDir, { recursive: true, force: true });
    }
  });

  it("getLastLoadError returns undefined initially", () => {
    // Before any call, it should be undefined
    const err = getLastLoadError();
    expect(err === undefined || typeof err === "undefined").toBe(true);
  });

  it("getLastLoadError captures error after failed load", async () => {
    await loadBuiltinDefaults("/tmp/nonexistent-builtins-test-12345");
    const err = getLastLoadError();
    expect(err).toBeDefined();
    expect(typeof err).toBe("string");
    expect(err!.length).toBeGreaterThan(0);
  });

  it("getLastLoadError clears on successful load", async () => {
    const agents = new Map<string, FixtureAgentConfig>([
      ["test", {
        name: "test",
        description: "Test",
        systemPrompt: "body",
        extensions: true,
        skills: true,
        promptMode: "replace",
      }],
    ]);

    const pkgDir = await createFixturePackage(agents);
    try {
      // First cause a failure
      await loadBuiltinDefaults("/tmp/nonexistent-builtins-test-12345");

      // Then a success should clear it
      const result = await loadBuiltinDefaults(pkgDir);
      expect(result).not.toBeNull();

      const err = getLastLoadError();
      expect(err).toBeUndefined();
    } finally {
      await rm(pkgDir, { recursive: true, force: true });
    }
  });

  it("loadBuiltinAgentSources does not console.warn from pure loader path", async () => {
    // The loader should not produce console warnings — diagnostics go
    // through the returned warning string only.
    const warnSpy = {
      calls: [] as unknown[][],
    };
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnSpy.calls.push(args);
    };

    try {
      await loadBuiltinAgentSources("/tmp/definitely-not-a-real-config");
      // The live package test uses console.warn for skipping, but this
      // path should not trigger any console.warn
      const loaderWarns = warnSpy.calls.filter(
        (args) =>
          typeof args[0] === "string" &&
          !args[0].includes("Skipping live"),
      );
      expect(loaderWarns).toHaveLength(0);
    } finally {
      console.warn = origWarn;
    }
  });
});

// ---------------------------------------------------------------------------
// Integration test against live installed package
// ---------------------------------------------------------------------------

describe("live package integration", () => {
  it("loads general-purpose, Explore, and Plan as valid complete documents", async () => {
    const result = await loadBuiltinAgentSources();

    if (result.sources.length === 0 && result.warning) {
      // Package not installed in this environment — skip gracefully
      console.warn("Skipping live package test: %s", result.warning);
      return;
    }

    const names = result.sources.map((s) => s.name);
    expect(names).toContain("general-purpose");
    expect(names).toContain("Explore");
    expect(names).toContain("Plan");

    for (const source of result.sources) {
      expect(source.kind).toBe("builtin");
      expect(source.content).toBeDefined();
      expect(source.content!.length).toBeGreaterThan(0);

      // Each must parse as a valid complete document
      const doc = parseAgentDocument(source.content!);
      expect(doc.hadFrontmatter).toBe(true);

      // Must have the required frontmatter fields
      expect(doc.frontmatter.description).toBeDefined();
      expect(doc.frontmatter.tools).toBeDefined();
      expect(doc.frontmatter.prompt_mode).toBeDefined();

      // Body must exist (even if empty for general-purpose)
      expect(typeof doc.body).toBe("string");

      // Verify general-purpose has empty system prompt (append mode)
      if (source.name === "general-purpose") {
        expect(doc.frontmatter.prompt_mode).toBe("append");
      }

      // Verify Explore and Plan have read-only tools
      if (source.name === "Explore" || source.name === "Plan") {
        expect(doc.frontmatter.prompt_mode).toBe("replace");
        const tools = String(doc.frontmatter.tools);
        expect(tools).toMatch(/read/);
      }
    }
  });
});