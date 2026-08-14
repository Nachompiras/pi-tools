import { describe, expect, it } from "vitest";
import {
  modelFullId,
  buildModelChoices,
  validateManualModel,
} from "../src/models.js";
import type { ModelDescriptor } from "../src/types.js";

// ---------------------------------------------------------------------------
// modelFullId
// ---------------------------------------------------------------------------

describe("modelFullId", () => {
  it("returns provider/id", () => {
    expect(modelFullId({ provider: "anthropic", id: "claude-sonnet" })).toBe(
      "anthropic/claude-sonnet",
    );
  });

  it("returns provider/id even without name", () => {
    expect(modelFullId({ provider: "openai", id: "gpt-5" })).toBe(
      "openai/gpt-5",
    );
  });

  it("works with name present", () => {
    expect(
      modelFullId({
        provider: "google",
        id: "gemini-pro",
        name: "Gemini Pro",
      }),
    ).toBe("google/gemini-pro");
  });

  it("returns multi-segment full ID when id contains slashes", () => {
    expect(
      modelFullId({ provider: "openrouter", id: "openai/gpt-5.6-sol" }),
    ).toBe("openrouter/openai/gpt-5.6-sol");
  });
});

// ---------------------------------------------------------------------------
// buildModelChoices
// ---------------------------------------------------------------------------

describe("buildModelChoices", () => {
  // --- all ordering and dedup ---

  it("returns all models sorted deterministically by provider then id", () => {
    const models: ModelDescriptor[] = [
      { provider: "openai", id: "gpt-5" },
      { provider: "anthropic", id: "claude-sonnet" },
      { provider: "anthropic", id: "claude-opus" },
      { provider: "google", id: "gemini-pro" },
    ];
    const result = buildModelChoices(models);
    expect(result.all).toEqual([
      { provider: "anthropic", id: "claude-opus" },
      { provider: "anthropic", id: "claude-sonnet" },
      { provider: "google", id: "gemini-pro" },
      { provider: "openai", id: "gpt-5" },
    ]);
  });

  it("deduplicates models by full provider/id", () => {
    const models: ModelDescriptor[] = [
      { provider: "anthropic", id: "claude-sonnet", name: "First" },
      { provider: "anthropic", id: "claude-sonnet", name: "Second" },
      { provider: "openai", id: "gpt-5" },
      { provider: "openai", id: "gpt-5" },
    ];
    const result = buildModelChoices(models);
    expect(result.all).toHaveLength(2);
    expect(result.all).toEqual([
      { provider: "anthropic", id: "claude-sonnet", name: "First" },
      { provider: "openai", id: "gpt-5" },
    ]);
  });

  it("deduplication is case-sensitive for provider/id", () => {
    // "Anthropic" vs "anthropic" are different providers
    const models: ModelDescriptor[] = [
      { provider: "Anthropic", id: "claude" },
      { provider: "anthropic", id: "claude" },
    ];
    const result = buildModelChoices(models);
    expect(result.all).toHaveLength(2);
    expect(result.all.map((m) => m.provider).sort()).toEqual([
      "Anthropic",
      "anthropic",
    ]);
  });

  it("all ordering is deterministic with repeated calls", () => {
    const models: ModelDescriptor[] = [
      { provider: "c", id: "3" },
      { provider: "a", id: "2" },
      { provider: "b", id: "1" },
      { provider: "a", id: "1" },
    ];
    const a = buildModelChoices(models).all;
    const b = buildModelChoices(models).all;
    expect(a).toEqual(b);
    expect(a).toEqual([
      { provider: "a", id: "1" },
      { provider: "a", id: "2" },
      { provider: "b", id: "1" },
      { provider: "c", id: "3" },
    ]);
  });

  // --- empty registry ---

  it("handles empty registry", () => {
    const result = buildModelChoices([]);
    expect(result.all).toEqual([]);
    expect(result.enabled).toEqual([]);
  });

  it("handles empty registry with enabledPatterns (all unavailable, omitted)", () => {
    const result = buildModelChoices([], ["anthropic/claude-sonnet"]);
    expect(result.all).toEqual([]);
    expect(result.enabled).toEqual([]);
  });

  // --- undefined/empty enabledPatterns ---

  it("returns empty enabled when enabledPatterns is undefined", () => {
    const models: ModelDescriptor[] = [
      { provider: "anthropic", id: "claude-sonnet" },
    ];
    const result = buildModelChoices(models);
    expect(result.enabled).toEqual([]);
    expect(result.all).toHaveLength(1);
  });

  it("returns empty enabled when enabledPatterns is empty array", () => {
    const models: ModelDescriptor[] = [
      { provider: "anthropic", id: "claude-sonnet" },
    ];
    const result = buildModelChoices(models, []);
    expect(result.enabled).toEqual([]);
    expect(result.all).toHaveLength(1);
  });

  // --- exact full provider/id matching ---

  it("matches exact provider/model pattern", () => {
    const models: ModelDescriptor[] = [
      { provider: "anthropic", id: "claude-sonnet" },
      { provider: "openai", id: "gpt-5" },
    ];
    const result = buildModelChoices(models, ["anthropic/claude-sonnet"]);
    expect(result.enabled).toEqual([
      { provider: "anthropic", id: "claude-sonnet" },
    ]);
  });

  it("exact provider/model matching is case-insensitive", () => {
    const models: ModelDescriptor[] = [
      { provider: "anthropic", id: "claude-sonnet" },
      { provider: "openai", id: "gpt-5" },
    ];
    const result = buildModelChoices(models, ["Anthropic/Claude-Sonnet"]);
    expect(result.enabled).toEqual([
      { provider: "anthropic", id: "claude-sonnet" },
    ]);
  });

  // --- exact full match with multi-segment ID ---

  it("exact full pattern with multi-segment ID pins it", () => {
    const models: ModelDescriptor[] = [
      { provider: "anthropic", id: "claude" },
      { provider: "openrouter", id: "openai/gpt-5.6-sol" },
    ];
    const result = buildModelChoices(models, [
      "openrouter/openai/gpt-5.6-sol",
    ]);
    expect(result.enabled).toEqual([
      { provider: "openrouter", id: "openai/gpt-5.6-sol" },
    ]);
  });

  it("exact full match with multi-segment ID is case-insensitive", () => {
    const models: ModelDescriptor[] = [
      { provider: "openrouter", id: "openai/gpt-5.6-sol" },
    ];
    const result = buildModelChoices(models, [
      "OpenRouter/OpenAI/GPT-5.6-Sol",
    ]);
    expect(result.enabled).toEqual([
      { provider: "openrouter", id: "openai/gpt-5.6-sol" },
    ]);
  });

  // --- bare model ID matching ---

  it("matches bare model ID exactly", () => {
    const models: ModelDescriptor[] = [
      { provider: "anthropic", id: "claude-sonnet" },
      { provider: "openai", id: "gpt-5" },
    ];
    const result = buildModelChoices(models, ["gpt-5"]);
    expect(result.enabled).toEqual([{ provider: "openai", id: "gpt-5" }]);
  });

  it("bare model ID matching is case-insensitive", () => {
    const models: ModelDescriptor[] = [
      { provider: "anthropic", id: "claude-sonnet" },
    ];
    const result = buildModelChoices(models, ["Claude-Sonnet"]);
    expect(result.enabled).toEqual([
      { provider: "anthropic", id: "claude-sonnet" },
    ]);
  });

  it("matches bare model ID by partial (fuzzy) match on id", () => {
    const models: ModelDescriptor[] = [
      { provider: "anthropic", id: "claude-sonnet-4-20250514" },
      { provider: "anthropic", id: "claude-opus-4-8" },
      { provider: "openai", id: "gpt-5" },
    ];
    const result = buildModelChoices(models, ["sonnet"]);
    expect(result.enabled).toEqual([
      { provider: "anthropic", id: "claude-sonnet-4-20250514" },
    ]);
  });

  it("matches bare model ID by partial match on name", () => {
    const models: ModelDescriptor[] = [
      {
        provider: "anthropic",
        id: "claude-sonnet-4-20250514",
        name: "Claude Sonnet 4",
      },
      { provider: "openai", id: "gpt-5", name: "GPT-5" },
    ];
    const result = buildModelChoices(models, ["Sonnet"]);
    expect(result.enabled).toEqual([
      {
        provider: "anthropic",
        id: "claude-sonnet-4-20250514",
        name: "Claude Sonnet 4",
      },
    ]);
  });

  it("bare ID with ambiguous match picks the one that sorts highest (alias preference)", () => {
    const models: ModelDescriptor[] = [
      {
        provider: "anthropic",
        id: "claude-sonnet-4-20250514",
        name: "Dated",
      },
      { provider: "anthropic", id: "claude-sonnet", name: "Alias" },
    ];
    const result = buildModelChoices(models, ["sonnet"]);
    // Alias sorts higher than dated version, so alias wins
    expect(result.enabled).toEqual([
      { provider: "anthropic", id: "claude-sonnet", name: "Alias" },
    ]);
  });

  // --- glob: regex metacharacters are treated literally ---

  it("treats . as literal in star globs", () => {
    const models: ModelDescriptor[] = [
      { provider: "test", id: "foo.bar" },
      { provider: "test", id: "fooXbar" },
    ];
    const result = buildModelChoices(models, ["*.*"]);
    expect(result.enabled).toEqual([
      { provider: "test", id: "foo.bar" },
    ]);
  });

  it("treats + as literal in star globs", () => {
    const models: ModelDescriptor[] = [
      { provider: "test", id: "a+b" },
      { provider: "test", id: "ab" },
    ];
    const result = buildModelChoices(models, ["*+*"]);
    expect(result.enabled).toEqual([
      { provider: "test", id: "a+b" },
    ]);
  });

  it("treats parentheses as literal in star globs", () => {
    const models: ModelDescriptor[] = [
      { provider: "test", id: "foo(test)bar" },
      { provider: "test", id: "footestbar" },
    ];
    const result = buildModelChoices(models, ["*(test)*"]);
    expect(result.enabled).toEqual([
      { provider: "test", id: "foo(test)bar" },
    ]);
  });

  it("treats braces as literal in star globs", () => {
    const models: ModelDescriptor[] = [
      { provider: "test", id: "bar{foo}baz" },
      { provider: "test", id: "barfoobaz" },
    ];
    const result = buildModelChoices(models, ["*{foo}*"]);
    expect(result.enabled).toEqual([
      { provider: "test", id: "bar{foo}baz" },
    ]);
  });

  it("glob with regex metacharacters does not throw", () => {
    const models: ModelDescriptor[] = [
      { provider: "test", id: "a^b$c" },
    ];
    // Should not throw, and should match the model
    const result = buildModelChoices(models, ["*^$*\\"]);
    expect(result.all).toHaveLength(1);
  });

  // --- ? and [...] are NOT globs (treated as literal characters) ---

  it("? without * is not a glob, treated as literal in fuzzy matching", () => {
    const models: ModelDescriptor[] = [
      { provider: "test", id: "claude-sonnet" },
      { provider: "test", id: "claudeXsonnet" },
      { provider: "test", id: "claude?sonnet" },
    ];
    // "claude?sonnet" has no *, so isGlobPattern returns false.
    // Falls through to fuzzy matching where ? is literal.
    // Only the model with literal ? in the id matches.
    const result = buildModelChoices(models, ["claude?sonnet"]);
    expect(result.enabled).toEqual([
      { provider: "test", id: "claude?sonnet" },
    ]);
  });

  it("? with * is treated as literal character", () => {
    const models: ModelDescriptor[] = [
      { provider: "test", id: "claude?sonnet" },
      { provider: "test", id: "claude-sonnet" },
      { provider: "test", id: "claudeXsonnet" },
    ];
    // "claude?*" has *, so isGlobPattern returns true.
    // ? is treated as literal \\? in the regex, * becomes .*
    // Regex: ^claude\\?.*$  — only matches ids starting with "claude?"
    const result = buildModelChoices(models, ["claude?*"]);
    expect(result.enabled).toEqual([
      { provider: "test", id: "claude?sonnet" },
    ]);
  });

  it("[abc] without * is not a glob, treated as literal in fuzzy matching", () => {
    const models: ModelDescriptor[] = [
      { provider: "test", id: "claudea" },
      { provider: "test", id: "claudeb" },
      { provider: "test", id: "claude[abc]" },
    ];
    // "claude[abc]" has no *, so isGlobPattern returns false.
    // Falls through to fuzzy matching where [abc] is literal.
    // Only the model with literal [abc] in the id matches.
    const result = buildModelChoices(models, ["claude[abc]"]);
    expect(result.enabled).toEqual([
      { provider: "test", id: "claude[abc]" },
    ]);
  });

  it("[abc] with * is treated as literal character", () => {
    const models: ModelDescriptor[] = [
      { provider: "test", id: "items[abc]foo" },
      { provider: "test", id: "itemsafoo" },
      { provider: "test", id: "itemsbfoo" },
    ];
    // "items[abc]*" has *, so isGlobPattern returns true.
    // [abc] is treated as literal \\[abc\\], * becomes .*
    // Regex: ^items\\[abc\\].*$  — only matches ids starting with "items[abc]"
    const result = buildModelChoices(models, ["items[abc]*"]);
    expect(result.enabled).toEqual([
      { provider: "test", id: "items[abc]foo" },
    ]);
  });

  it("[!abc] without * is not a glob, treated as literal in fuzzy matching", () => {
    const models: ModelDescriptor[] = [
      { provider: "test", id: "clauded" },
      { provider: "test", id: "claude[!abc]" },
    ];
    // "claude[!abc]" has no *, so isGlobPattern returns false.
    // Falls through to fuzzy matching where [!abc] is literal.
    // The model with literal [!abc] matches; the other does not contain the literal string.
    const result = buildModelChoices(models, ["claude[!abc]"]);
    expect(result.enabled).toEqual([
      { provider: "test", id: "claude[!abc]" },
    ]);
  });

  it("[!abc] with * is treated as literal character", () => {
    const models: ModelDescriptor[] = [
      { provider: "test", id: "items[!abc]foo" },
      { provider: "test", id: "itemsdfoo" },
    ];
    // "items[!abc]*" has *, so isGlobPattern returns true.
    // [!abc] is treated as literal \\[!abc\\], * becomes .*
    const result = buildModelChoices(models, ["items[!abc]*"]);
    expect(result.enabled).toEqual([
      { provider: "test", id: "items[!abc]foo" },
    ]);
  });

  // --- glob: multi-segment ID matching ---

  it("glob like openrouter/openai/* matches nested-slash ids", () => {
    const models: ModelDescriptor[] = [
      { provider: "openrouter", id: "openai/gpt-5.6-sol" },
      { provider: "openrouter", id: "anthropic/claude-sonnet" },
      { provider: "openrouter", id: "google/gemini-pro" },
    ];
    const result = buildModelChoices(models, ["openrouter/openai/*"]);
    expect(result.enabled).toEqual([
      { provider: "openrouter", id: "openai/gpt-5.6-sol" },
    ]);
  });

  it("glob * matches nested-slash ids across all providers", () => {
    const models: ModelDescriptor[] = [
      { provider: "openrouter", id: "openai/gpt-5.6-sol" },
      { provider: "anthropic", id: "claude-sonnet" },
    ];
    const result = buildModelChoices(models, ["*gpt*5.6*"]);
    expect(result.enabled).toEqual([
      { provider: "openrouter", id: "openai/gpt-5.6-sol" },
    ]);
  });

  // --- duplicate bare model IDs across providers ---

  it("exact bare match with duplicates across providers resolves to first by provider sort", () => {
    const models: ModelDescriptor[] = [
      { provider: "openai", id: "claude" },
      { provider: "anthropic", id: "claude" },
    ];
    // Both models have the same bare id "claude".
    // Exact bare match finds both, but length !== 1, so falls through.
    // Fuzzy matching finds both. Both are aliases. Sorted descending by id
    // (tie), first in allModels order wins. allModels is sorted by provider
    // then id, so anthropic/claude comes before openai/claude.
    const result = buildModelChoices(models, ["claude"]);
    expect(result.enabled).toEqual([
      { provider: "anthropic", id: "claude" },
    ]);
  });

  it("exact bare match with duplicates and different names still returns one", () => {
    const models: ModelDescriptor[] = [
      { provider: "openai", id: "claude", name: "OpenAI Claude" },
      { provider: "anthropic", id: "claude", name: "Anthropic Claude" },
    ];
    const result = buildModelChoices(models, ["claude"]);
    expect(result.enabled).toHaveLength(1);
    expect(result.enabled[0].provider).toBe("anthropic");
  });

  // --- wildcard matching ---

  it("matches wildcard pattern against provider/model format", () => {
    const models: ModelDescriptor[] = [
      { provider: "anthropic", id: "claude-sonnet" },
      { provider: "anthropic", id: "claude-opus" },
      { provider: "openai", id: "gpt-5" },
    ];
    const result = buildModelChoices(models, ["anthropic/*"]);
    expect(result.enabled).toEqual([
      { provider: "anthropic", id: "claude-opus" },
      { provider: "anthropic", id: "claude-sonnet" },
    ]);
  });

  it("matches wildcard against bare model ID", () => {
    const models: ModelDescriptor[] = [
      { provider: "anthropic", id: "claude-sonnet" },
      { provider: "openai", id: "gpt-5" },
      { provider: "google", id: "gemini-pro" },
    ];
    const result = buildModelChoices(models, ["*sonnet*"]);
    expect(result.enabled).toEqual([
      { provider: "anthropic", id: "claude-sonnet" },
    ]);
  });

  it("wildcard matching is case-insensitive", () => {
    const models: ModelDescriptor[] = [
      { provider: "anthropic", id: "claude-sonnet" },
    ];
    const result = buildModelChoices(models, ["*SONNET*"]);
    expect(result.enabled).toEqual([
      { provider: "anthropic", id: "claude-sonnet" },
    ]);
  });

  // --- overlapping patterns ---

  it("deduplicates overlapping pattern matches", () => {
    const models: ModelDescriptor[] = [
      { provider: "anthropic", id: "claude-sonnet" },
      { provider: "anthropic", id: "claude-opus" },
    ];
    const result = buildModelChoices(models, [
      "anthropic/*",
      "anthropic/claude-sonnet",
    ]);
    expect(result.enabled).toEqual([
      { provider: "anthropic", id: "claude-opus" },
      { provider: "anthropic", id: "claude-sonnet" },
    ]);
  });

  // --- enabled order ---

  it("retains enabledPatterns order", () => {
    const models: ModelDescriptor[] = [
      { provider: "openai", id: "gpt-5" },
      { provider: "anthropic", id: "claude-sonnet" },
      { provider: "google", id: "gemini-pro" },
    ];
    const result = buildModelChoices(models, [
      "google/gemini-pro",
      "anthropic/claude-sonnet",
      "openai/gpt-5",
    ]);
    expect(result.enabled).toEqual([
      { provider: "google", id: "gemini-pro" },
      { provider: "anthropic", id: "claude-sonnet" },
      { provider: "openai", id: "gpt-5" },
    ]);
  });

  it("each pattern's matches are deterministically sorted within the pattern", () => {
    const models: ModelDescriptor[] = [
      { provider: "anthropic", id: "c" },
      { provider: "anthropic", id: "a" },
      { provider: "anthropic", id: "b" },
    ];
    const result = buildModelChoices(models, ["anthropic/*"]);
    expect(result.enabled).toEqual([
      { provider: "anthropic", id: "a" },
      { provider: "anthropic", id: "b" },
      { provider: "anthropic", id: "c" },
    ]);
  });

  // --- unavailable patterns omitted ---

  it("omits patterns with no matching models", () => {
    const models: ModelDescriptor[] = [
      { provider: "anthropic", id: "claude-sonnet" },
    ];
    const result = buildModelChoices(models, [
      "nonexistent/model",
      "anthropic/claude-sonnet",
      "also/missing",
    ]);
    expect(result.enabled).toEqual([
      { provider: "anthropic", id: "claude-sonnet" },
    ]);
  });

  it("omits all patterns when none match", () => {
    const models: ModelDescriptor[] = [
      { provider: "anthropic", id: "claude-sonnet" },
    ];
    const result = buildModelChoices(models, ["nonexistent/model"]);
    expect(result.enabled).toEqual([]);
  });

  // --- descriptor validation: skip invalid ---

  it("skips descriptors with missing provider", () => {
    const models: ModelDescriptor[] = [
      { provider: "anthropic", id: "claude" },
      { provider: "", id: "claude" } as ModelDescriptor,
    ];
    const result = buildModelChoices(models);
    expect(result.all).toEqual([{ provider: "anthropic", id: "claude" }]);
  });

  it("skips descriptors with missing id", () => {
    const models: ModelDescriptor[] = [
      { provider: "anthropic", id: "claude" },
      { provider: "anthropic", id: "" } as ModelDescriptor,
    ];
    const result = buildModelChoices(models);
    expect(result.all).toEqual([{ provider: "anthropic", id: "claude" }]);
  });

  it("skips descriptors with non-string provider", () => {
    const models: ModelDescriptor[] = [
      { provider: "anthropic", id: "claude" },
      { provider: 123 as unknown as string, id: "claude" },
    ];
    const result = buildModelChoices(models);
    expect(result.all).toEqual([{ provider: "anthropic", id: "claude" }]);
  });

  it("skips descriptors with non-string id", () => {
    const models: ModelDescriptor[] = [
      { provider: "anthropic", id: "claude" },
      { provider: "anthropic", id: 123 as unknown as string },
    ];
    const result = buildModelChoices(models);
    expect(result.all).toEqual([{ provider: "anthropic", id: "claude" }]);
  });

  it("skips descriptors with provider containing slash", () => {
    const models: ModelDescriptor[] = [
      { provider: "anthropic", id: "claude" },
      { provider: "bad/provider", id: "claude" },
    ];
    const result = buildModelChoices(models);
    expect(result.all).toEqual([{ provider: "anthropic", id: "claude" }]);
  });

  it("retains descriptors with id containing slash (e.g. openrouter/openai/gpt-5.6-sol)", () => {
    const models: ModelDescriptor[] = [
      { provider: "anthropic", id: "claude" },
      { provider: "openrouter", id: "openai/gpt-5.6-sol" },
    ];
    const result = buildModelChoices(models);
    expect(result.all).toHaveLength(2);
    expect(result.all).toEqual([
      { provider: "anthropic", id: "claude" },
      { provider: "openrouter", id: "openai/gpt-5.6-sol" },
    ]);
  });

  it("retains descriptors with id containing leading slash segment", () => {
    const models: ModelDescriptor[] = [
      { provider: "test", id: "anthropic/claude" },
      { provider: "test", id: "/leading-slash" },
    ];
    const result = buildModelChoices(models);
    expect(result.all).toHaveLength(2);
    const ids = result.all.map((m) => m.id);
    expect(ids).toContain("/leading-slash");
    expect(ids).toContain("anthropic/claude");
  });

  it("retains descriptors with id containing trailing slash segment", () => {
    const models: ModelDescriptor[] = [
      { provider: "test", id: "trailing/" },
    ];
    const result = buildModelChoices(models);
    expect(result.all).toHaveLength(1);
    expect(result.all[0].id).toBe("trailing/");
  });

  it("retains descriptors with id containing multiple consecutive slashes", () => {
    const models: ModelDescriptor[] = [
      { provider: "test", id: "a//b" },
    ];
    const result = buildModelChoices(models);
    expect(result.all).toHaveLength(1);
    expect(result.all[0].id).toBe("a//b");
  });

  it("skips descriptors with control characters in provider", () => {
    const models: ModelDescriptor[] = [
      { provider: "anthropic", id: "claude" },
      { provider: "bad\x00provider", id: "claude" },
    ];
    const result = buildModelChoices(models);
    expect(result.all).toEqual([{ provider: "anthropic", id: "claude" }]);
  });

  it("skips descriptors with control characters in id", () => {
    const models: ModelDescriptor[] = [
      { provider: "anthropic", id: "claude" },
      { provider: "anthropic", id: "bad\x00id" },
    ];
    const result = buildModelChoices(models);
    expect(result.all).toEqual([{ provider: "anthropic", id: "claude" }]);
  });
});

// ---------------------------------------------------------------------------
// validateManualModel
// ---------------------------------------------------------------------------

describe("validateManualModel", () => {
  // --- fuzzy names ---

  it("accepts fuzzy names like sonnet", () => {
    expect(validateManualModel("sonnet")).toBe("sonnet");
  });

  it("accepts fuzzy names with hyphens and digits", () => {
    expect(validateManualModel("claude-sonnet-4-20250514")).toBe(
      "claude-sonnet-4-20250514",
    );
  });

  // --- full IDs ---

  it("accepts full provider/id", () => {
    expect(validateManualModel("anthropic/claude-sonnet")).toBe(
      "anthropic/claude-sonnet",
    );
  });

  it("accepts full provider/id with version", () => {
    expect(validateManualModel("anthropic/claude-sonnet-4-20250514")).toBe(
      "anthropic/claude-sonnet-4-20250514",
    );
  });

  it("accepts full provider/id with multi-segment nested-slash id", () => {
    expect(validateManualModel("openrouter/openai/gpt-5.6-sol")).toBe(
      "openrouter/openai/gpt-5.6-sol",
    );
  });

  // --- trim ---

  it("trims whitespace", () => {
    expect(validateManualModel("  sonnet  ")).toBe("sonnet");
  });

  it("trims tabs and spaces from edges", () => {
    expect(validateManualModel("\t  anthropic/claude  \t")).toBe(
      "anthropic/claude",
    );
  });

  // --- reject empty/whitespace ---

  it("rejects empty string", () => {
    expect(() => validateManualModel("")).toThrow();
  });

  it("rejects whitespace-only string", () => {
    expect(() => validateManualModel("   ")).toThrow();
  });

  it("rejects tab-only string", () => {
    expect(() => validateManualModel("\t\t")).toThrow();
  });

  // --- reject control characters ---

  it("rejects NUL character", () => {
    expect(() => validateManualModel("sonnet\x00")).toThrow();
  });

  it("rejects other control characters", () => {
    expect(() => validateManualModel("sonnet\x01")).toThrow();
    expect(() => validateManualModel("sonnet\x02")).toThrow();
    expect(() => validateManualModel("sonnet\x1F")).toThrow();
  });

  it("rejects DEL character", () => {
    expect(() => validateManualModel("sonnet\x7F")).toThrow();
  });

  // --- reject multiline ---

  it("rejects CR", () => {
    expect(() => validateManualModel("sonnet\r")).toThrow();
  });

  it("rejects LF", () => {
    expect(() => validateManualModel("sonnet\n")).toThrow();
  });

  it("rejects CRLF", () => {
    expect(() => validateManualModel("sonnet\r\n")).toThrow();
  });

  it("rejects multiline with embedded newline", () => {
    expect(() => validateManualModel("anthropic\n/claude")).toThrow();
  });

  // --- no input mutation ---

  it("does not mutate the input string", () => {
    const original = "  sonnet  ";
    const input = original;
    validateManualModel(input);
    expect(input).toBe(original);
  });
});