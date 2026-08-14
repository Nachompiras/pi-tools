import { describe, expect, it } from "vitest";
import type { AgentDocument, EditableAgentConfig } from "../src/types.js";
import { parseAgentDocument, updateAgentDocument } from "../src/frontmatter.js";

// --- parseAgentDocument ---

describe("parseAgentDocument", () => {
  it("parses normal frontmatter plus body", () => {
    const content = [
      "---",
      "model: anthropic/claude-sonnet-4-20250514",
      "thinking: high",
      "max_turns: 20",
      "---",
      "# Agent Title",
      "",
      "System prompt body here.",
    ].join("\n");

    const doc = parseAgentDocument(content);

    expect(doc.hadFrontmatter).toBe(true);
    expect(doc.frontmatter).toEqual({
      model: "anthropic/claude-sonnet-4-20250514",
      thinking: "high",
      max_turns: 20,
    });
    expect(doc.body).toBe("# Agent Title\n\nSystem prompt body here.");
  });

  it("handles no frontmatter", () => {
    const content = "# Just a markdown document\n\nWith some body text.";

    const doc = parseAgentDocument(content);

    expect(doc.hadFrontmatter).toBe(false);
    expect(doc.frontmatter).toEqual({});
    expect(doc.body).toBe(content);
  });

  it("handles quoted scalar values", () => {
    const content = [
      "---",
      'name: "quoted value"',
      "model: anthropic/claude-sonnet-4-20250514",
      "---",
      "body",
    ].join("\n");

    const doc = parseAgentDocument(content);

    expect(doc.hadFrontmatter).toBe(true);
    expect(doc.frontmatter.name).toBe("quoted value");
    expect(doc.frontmatter.model).toBe("anthropic/claude-sonnet-4-20250514");
  });

  it("preserves booleans and arrays in unrelated fields", () => {
    const content = [
      "---",
      "model: anthropic/claude-sonnet-4-20250514",
      "enabled: true",
      "tags:",
      "  - a",
      "  - b",
      "  - c",
      "thinking: medium",
      "---",
      "body",
    ].join("\n");

    const doc = parseAgentDocument(content);

    expect(doc.hadFrontmatter).toBe(true);
    expect(doc.frontmatter.enabled).toBe(true);
    expect(doc.frontmatter.tags).toEqual(["a", "b", "c"]);
    expect(doc.frontmatter.model).toBe("anthropic/claude-sonnet-4-20250514");
    expect(doc.frontmatter.thinking).toBe("medium");
  });

  it("handles body text containing --- after opening frontmatter", () => {
    const content = [
      "---",
      "model: test-model",
      "---",
      "Some body text",
      "---",
      "more body that looks like frontmatter",
    ].join("\n");

    const doc = parseAgentDocument(content);

    expect(doc.hadFrontmatter).toBe(true);
    expect(doc.frontmatter.model).toBe("test-model");
    // Body must include everything after the first closing delimiter, including the --- lines
    expect(doc.body).toBe("Some body text\n---\nmore body that looks like frontmatter");
  });

  it("handles CRLF input", () => {
    const content = [
      "---",
      "model: test-model",
      "thinking: low",
      "---",
      "Body line 1",
      "Body line 2",
    ].join("\r\n");

    const doc = parseAgentDocument(content);

    expect(doc.hadFrontmatter).toBe(true);
    expect(doc.frontmatter.model).toBe("test-model");
    expect(doc.frontmatter.thinking).toBe("low");
    expect(doc.body).toBe("Body line 1\r\nBody line 2");
  });

  it("throws clear error for malformed YAML", () => {
    const content = [
      "---",
      "model: [unclosed bracket",
      "---",
      "body",
    ].join("\n");

    expect(() => parseAgentDocument(content)).toThrow(/YAML|parse|malformed/i);
  });

  it("throws clear error for unterminated frontmatter", () => {
    const content = [
      "---",
      "model: test-model",
      "Body text without closing delimiter",
    ].join("\n");

    expect(() => parseAgentDocument(content)).toThrow(/unterminated|frontmatter|closing/i);
  });

  it("does not recognize --- not at start of document", () => {
    const content = [
      "",
      "---",
      "model: test-model",
      "---",
      "body",
    ].join("\n");

    const doc = parseAgentDocument(content);

    expect(doc.hadFrontmatter).toBe(false);
    expect(doc.frontmatter).toEqual({});
    expect(doc.body).toBe(content);
  });

  it("handles frontmatter with only whitespace before closing delimiter", () => {
    const content = [
      "---",
      "model: test-model",
      "---",
      "body",
    ].join("\n");

    const doc = parseAgentDocument(content);

    expect(doc.hadFrontmatter).toBe(true);
    expect(doc.frontmatter.model).toBe("test-model");
    expect(doc.body).toBe("body");
  });

  it("handles empty frontmatter with LF", () => {
    const content = "---\n---\nbody";

    const doc = parseAgentDocument(content);

    expect(doc.hadFrontmatter).toBe(true);
    expect(doc.frontmatter).toEqual({});
    expect(doc.body).toBe("body");
  });

  it("handles empty frontmatter with CRLF", () => {
    const content = "---\r\n---\r\nbody";

    const doc = parseAgentDocument(content);

    expect(doc.hadFrontmatter).toBe(true);
    expect(doc.frontmatter).toEqual({});
    expect(doc.body).toBe("body");
  });

  it("handles closing delimiter at EOF without trailing newline", () => {
    const content = "---\nmodel: test-model\n---";

    const doc = parseAgentDocument(content);

    expect(doc.hadFrontmatter).toBe(true);
    expect(doc.frontmatter.model).toBe("test-model");
    expect(doc.body).toBe("");
  });

  it("throws for scalar YAML root instead of coercing to {}", () => {
    const content = "---\n42\n---\nbody";

    expect(() => parseAgentDocument(content)).toThrow(
      /frontmatter.*(?:object|map|mapping)/i,
    );
  });

  it("throws for array YAML root instead of coercing to {}", () => {
    const content = "---\n- a\n- b\n---\nbody";

    expect(() => parseAgentDocument(content)).toThrow(
      /frontmatter.*(?:object|map|mapping)/i,
    );
  });
});

// --- updateAgentDocument ---

describe("updateAgentDocument", () => {
  it("updates all 3 supported fields", () => {
    const content = [
      "---",
      "model: old-model",
      "thinking: low",
      "max_turns: 10",
      "---",
      "body text",
    ].join("\n");

    const config: EditableAgentConfig = {
      model: "new-model",
      thinking: "high",
      maxTurns: 25,
    };

    const result = updateAgentDocument(content, config);

    const doc = parseAgentDocument(result);
    expect(doc.frontmatter.model).toBe("new-model");
    expect(doc.frontmatter.thinking).toBe("high");
    expect(doc.frontmatter.max_turns).toBe(25);
    expect(doc.body).toBe("body text");
  });

  it("maps maxTurns to on-disk max_turns", () => {
    const content = [
      "---",
      "model: test-model",
      "---",
      "body",
    ].join("\n");

    const config: EditableAgentConfig = { maxTurns: 42 };

    const result = updateAgentDocument(content, config);

    const doc = parseAgentDocument(result);
    expect(doc.frontmatter.max_turns).toBe(42);
    // maxTurns should not appear
    expect(doc.frontmatter).not.toHaveProperty("maxTurns");
  });

  it("removes model when set to undefined", () => {
    const content = [
      "---",
      "model: old-model",
      "thinking: medium",
      "max_turns: 10",
      "---",
      "body text",
    ].join("\n");

    const config: EditableAgentConfig = { model: undefined };

    const result = updateAgentDocument(content, config);

    const doc = parseAgentDocument(result);
    expect(doc.frontmatter).not.toHaveProperty("model");
    expect(doc.frontmatter.thinking).toBe("medium");
    expect(doc.frontmatter.max_turns).toBe(10);
    expect(doc.body).toBe("body text");
  });

  it("removes thinking when set to undefined", () => {
    const content = [
      "---",
      "model: old-model",
      "thinking: medium",
      "max_turns: 10",
      "---",
      "body text",
    ].join("\n");

    const config: EditableAgentConfig = { thinking: undefined };

    const result = updateAgentDocument(content, config);

    const doc = parseAgentDocument(result);
    expect(doc.frontmatter.model).toBe("old-model");
    expect(doc.frontmatter).not.toHaveProperty("thinking");
    expect(doc.frontmatter.max_turns).toBe(10);
    expect(doc.body).toBe("body text");
  });

  it("removes max_turns when set to undefined", () => {
    const content = [
      "---",
      "model: old-model",
      "thinking: medium",
      "max_turns: 10",
      "---",
      "body text",
    ].join("\n");

    const config: EditableAgentConfig = { maxTurns: undefined };

    const result = updateAgentDocument(content, config);

    const doc = parseAgentDocument(result);
    expect(doc.frontmatter.model).toBe("old-model");
    expect(doc.frontmatter.thinking).toBe("medium");
    expect(doc.frontmatter).not.toHaveProperty("max_turns");
    expect(doc.body).toBe("body text");
  });

  it("preserves unrelated parsed values and body exactly", () => {
    const content = [
      "---",
      "model: test-model",
      "thinking: medium",
      "extra_field: preserved-value",
      "tags:",
      "  - a",
      "  - b",
      "enabled: true",
      "---",
      "# Body",
      "",
      "Preserved body content.",
    ].join("\n");

    const config: EditableAgentConfig = { maxTurns: 15 };

    const result = updateAgentDocument(content, config);

    const doc = parseAgentDocument(result);
    expect(doc.frontmatter.model).toBe("test-model");
    expect(doc.frontmatter.thinking).toBe("medium");
    expect(doc.frontmatter.max_turns).toBe(15);
    expect(doc.frontmatter.extra_field).toBe("preserved-value");
    expect(doc.frontmatter.tags).toEqual(["a", "b"]);
    expect(doc.frontmatter.enabled).toBe(true);
    expect(doc.body).toBe("# Body\n\nPreserved body content.");
  });

  it("preserves body exactly including trailing whitespace", () => {
    const content = [
      "---",
      "model: test-model",
      "---",
      "body with trailing space  ",
      "",
      "and a trailing newline",
    ].join("\n") + "\n";

    const config: EditableAgentConfig = { thinking: "off" };

    const result = updateAgentDocument(content, config);

    const doc = parseAgentDocument(result);
    expect(doc.frontmatter.thinking).toBe("off");
    expect(doc.body).toBe("body with trailing space  \n\nand a trailing newline\n");
  });

  it("produces valid frontmatter for body-only document", () => {
    const content = "# Just a body\n\nNo frontmatter here.";

    const config: EditableAgentConfig = {
      model: "new-model",
      thinking: "xhigh",
      maxTurns: 30,
    };

    const result = updateAgentDocument(content, config);

    const doc = parseAgentDocument(result);
    expect(doc.hadFrontmatter).toBe(true);
    expect(doc.frontmatter.model).toBe("new-model");
    expect(doc.frontmatter.thinking).toBe("xhigh");
    expect(doc.frontmatter.max_turns).toBe(30);
    expect(doc.body).toBe(content);
  });

  it("adds frontmatter for body-only document with partial config", () => {
    const content = "body only";

    const config: EditableAgentConfig = { model: "some-model" };

    const result = updateAgentDocument(content, config);

    const doc = parseAgentDocument(result);
    expect(doc.hadFrontmatter).toBe(true);
    expect(doc.frontmatter.model).toBe("some-model");
    expect(doc.frontmatter).not.toHaveProperty("thinking");
    expect(doc.frontmatter).not.toHaveProperty("max_turns");
    expect(doc.body).toBe("body only");
  });

  it("does not add unrelated fields to frontmatter", () => {
    const content = [
      "---",
      "model: test-model",
      "---",
      "body",
    ].join("\n");

    const config: EditableAgentConfig = { model: "new-model" };

    const result = updateAgentDocument(content, config);

    const doc = parseAgentDocument(result);
    const keys = Object.keys(doc.frontmatter);
    expect(keys).toHaveLength(1);
    expect(keys).toContain("model");
  });

  it("sets multiple fields to undefined independently", () => {
    const content = [
      "---",
      "model: old-model",
      "thinking: low",
      "max_turns: 10",
      "extra: kept",
      "---",
      "body",
    ].join("\n");

    const config: EditableAgentConfig = {
      model: undefined,
      thinking: undefined,
    };

    const result = updateAgentDocument(content, config);

    const doc = parseAgentDocument(result);
    expect(doc.frontmatter).not.toHaveProperty("model");
    expect(doc.frontmatter).not.toHaveProperty("thinking");
    expect(doc.frontmatter.max_turns).toBe(10);
    expect(doc.frontmatter.extra).toBe("kept");
    expect(doc.body).toBe("body");
  });

  it("returns body-only when all keys are removed", () => {
    const content = [
      "---",
      "model: old-model",
      "thinking: low",
      "---",
      "# Body",
      "",
      "Exact body content.",
    ].join("\n");

    const config: EditableAgentConfig = {
      model: undefined,
      thinking: undefined,
    };

    const result = updateAgentDocument(content, config);

    // No frontmatter delimiters in the result
    expect(result).toBe("# Body\n\nExact body content.");
    // Round-trip parse confirms body is preserved exactly
    const doc = parseAgentDocument(result);
    expect(doc.hadFrontmatter).toBe(false);
    expect(doc.frontmatter).toEqual({});
    expect(doc.body).toBe("# Body\n\nExact body content.");
  });
});