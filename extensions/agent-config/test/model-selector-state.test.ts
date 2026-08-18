import { describe, expect, it } from "vitest";
import { ModelSelectorState } from "../src/model-selector-state.js";
import type { ModelDescriptor, ModelSelectorItem } from "../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeModel(
  provider: string,
  id: string,
  name?: string,
): ModelDescriptor {
  return { provider, id, name };
}

// ---------------------------------------------------------------------------
// Construction & items
// ---------------------------------------------------------------------------

describe("ModelSelectorState construction", () => {
  it("creates items with pinned actions first, then all models", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [
        makeModel("anthropic", "claude-sonnet"),
        makeModel("openai", "gpt-5"),
      ],
    });
    const items = state.items;
    expect(items).toHaveLength(4);
    expect(items[0]).toEqual({ kind: "inherit", key: "inherit" });
    expect(items[1]).toEqual({ kind: "manual", key: "manual" });
    expect(items[2]).toEqual({
      kind: "model",
      key: "anthropic/claude-sonnet",
      model: makeModel("anthropic", "claude-sonnet"),
      enabled: false,
    });
    expect(items[3]).toEqual({
      kind: "model",
      key: "openai/gpt-5",
      model: makeModel("openai", "gpt-5"),
      enabled: false,
    });
  });

  it("puts enabled models first among model items, in scoped order", () => {
    const state = new ModelSelectorState({
      enabled: [
        makeModel("openai", "gpt-5"),
        makeModel("anthropic", "claude-sonnet"),
      ],
      all: [
        makeModel("anthropic", "claude-sonnet"),
        makeModel("google", "gemini-pro"),
        makeModel("openai", "gpt-5"),
      ],
    });
    const modelItems = state.items.filter((i) => i.kind === "model");
    // enabled first in scoped order: openai/gpt-5, anthropic/claude-sonnet
    // then remaining: google/gemini-pro
    expect(modelItems[0].key).toBe("openai/gpt-5");
    expect(modelItems[0].enabled).toBe(true);
    expect(modelItems[1].key).toBe("anthropic/claude-sonnet");
    expect(modelItems[1].enabled).toBe(true);
    expect(modelItems[2].key).toBe("google/gemini-pro");
    expect(modelItems[2].enabled).toBe(false);
  });

  it("remaining models are sorted deterministically by provider then id", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [
        makeModel("c-provider", "b-id"),
        makeModel("a-provider", "z-id"),
        makeModel("a-provider", "a-id"),
        makeModel("b-provider", "a-id"),
      ],
    });
    const modelItems = state.items.filter((i) => i.kind === "model");
    const keys = modelItems.map((i) => i.key);
    expect(keys).toEqual([
      "a-provider/a-id",
      "a-provider/z-id",
      "b-provider/a-id",
      "c-provider/b-id",
    ]);
  });

  it("deduplicates by full model ID (exact match)", () => {
    const state = new ModelSelectorState({
      enabled: [makeModel("anthropic", "claude-sonnet")],
      all: [
        makeModel("anthropic", "claude-sonnet"),
        makeModel("anthropic", "claude-sonnet"),
      ],
    });
    const modelItems = state.items.filter((i) => i.kind === "model");
    expect(modelItems).toHaveLength(1);
    expect(modelItems[0].key).toBe("anthropic/claude-sonnet");
  });

  it("does not mutate input arrays", () => {
    const enabled = [makeModel("openai", "gpt-5")];
    const all = [makeModel("openai", "gpt-5"), makeModel("anthropic", "claude")];
    const enabledCopy = [...enabled];
    const allCopy = [...all];
    new ModelSelectorState({ enabled, all });
    expect(enabled).toEqual(enabledCopy);
    expect(all).toEqual(allCopy);
  });

  it("does not mutate input descriptor objects", () => {
    const enabledModel = makeModel("openai", "gpt-5", "GPT-5");
    const allModel = makeModel("anthropic", "claude-sonnet", "Claude Sonnet");
    const enabled = [enabledModel];
    const all = [allModel];
    new ModelSelectorState({ enabled, all });
    // Objects should not be mutated
    expect(enabledModel.name).toBe("GPT-5");
    expect(enabledModel.provider).toBe("openai");
    expect(enabledModel.id).toBe("gpt-5");
    expect(allModel.name).toBe("Claude Sonnet");
    expect(allModel.provider).toBe("anthropic");
    expect(allModel.id).toBe("claude-sonnet");
  });

  it("handles empty enabled and empty all", () => {
    const state = new ModelSelectorState({ enabled: [], all: [] });
    const items = state.items;
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ kind: "inherit", key: "inherit" });
    expect(items[1]).toEqual({ kind: "manual", key: "manual" });
  });

  it("ignores duplicate enabled entries (first occurrence wins enabled flag)", () => {
    const state = new ModelSelectorState({
      enabled: [
        makeModel("anthropic", "claude-sonnet"),
        makeModel("anthropic", "claude-sonnet"),
      ],
      all: [makeModel("anthropic", "claude-sonnet")],
    });
    const modelItems = state.items.filter((i) => i.kind === "model");
    expect(modelItems).toHaveLength(1);
    expect(modelItems[0].enabled).toBe(true);
  });

  // -------------------------------------------------------------------
  // Spec: selectable universe must come only from options.all
  // -------------------------------------------------------------------

  it("ignores enabled descriptors absent from all (not displayed)", () => {
    const state = new ModelSelectorState({
      enabled: [makeModel("openai", "gpt-5")],
      all: [makeModel("anthropic", "claude-sonnet")],
    });
    const modelItems = state.items.filter((i) => i.kind === "model");
    // openai/gpt-5 is in enabled but not in all, so it must not appear
    expect(modelItems).toHaveLength(1);
    expect(modelItems[0].key).toBe("anthropic/claude-sonnet");
    expect(modelItems[0].enabled).toBe(false);
  });

  it("ignores enabled descriptors absent from all (not searchable)", () => {
    const state = new ModelSelectorState({
      enabled: [makeModel("openai", "gpt-5")],
      all: [makeModel("anthropic", "claude-sonnet")],
    });
    state.setQuery("gpt");
    const modelItems = state.items.filter((i) => i.kind === "model");
    // openai/gpt-5 should not be searchable because it's not in all
    expect(modelItems).toHaveLength(0);
  });

  it("uses canonical all descriptor data when enabled has different name", () => {
    const state = new ModelSelectorState({
      enabled: [makeModel("anthropic", "claude-sonnet", "Custom Name")],
      all: [makeModel("anthropic", "claude-sonnet", "Claude Sonnet")],
    });
    const modelItems = state.items.filter((i) => i.kind === "model");
    expect(modelItems).toHaveLength(1);
    expect(modelItems[0].enabled).toBe(true);
    // Name must come from all (canonical), not from enabled
    expect(modelItems[0].model.name).toBe("Claude Sonnet");
    // Provider and id also come from all
    expect(modelItems[0].model.provider).toBe("anthropic");
    expect(modelItems[0].model.id).toBe("claude-sonnet");
  });

  it("preserves enabled ordering but uses all descriptor data", () => {
    const state = new ModelSelectorState({
      enabled: [
        makeModel("openai", "gpt-5"),
        makeModel("anthropic", "claude-sonnet"),
      ],
      all: [
        makeModel("anthropic", "claude-sonnet", "Claude Sonnet"),
        makeModel("openai", "gpt-5", "GPT-5"),
        makeModel("google", "gemini-pro"),
      ],
    });
    const modelItems = state.items.filter((i) => i.kind === "model");
    // Enabled first in scoped order: openai/gpt-5, anthropic/claude-sonnet
    // then remaining: google/gemini-pro
    expect(modelItems[0].key).toBe("openai/gpt-5");
    expect(modelItems[0].enabled).toBe(true);
    expect(modelItems[0].model.name).toBe("GPT-5");
    expect(modelItems[1].key).toBe("anthropic/claude-sonnet");
    expect(modelItems[1].enabled).toBe(true);
    expect(modelItems[1].model.name).toBe("Claude Sonnet");
    expect(modelItems[2].key).toBe("google/gemini-pro");
    expect(modelItems[2].enabled).toBe(false);
  });

  it("deduplicates all by first occurrence", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [
        makeModel("anthropic", "claude-sonnet", "First"),
        makeModel("anthropic", "claude-sonnet", "Second"),
      ],
    });
    const modelItems = state.items.filter((i) => i.kind === "model");
    expect(modelItems).toHaveLength(1);
    expect(modelItems[0].model.name).toBe("First");
  });
});

// ---------------------------------------------------------------------------
// Initial selection (current model)
// ---------------------------------------------------------------------------

describe("initial selection", () => {
  it("defaults to index 0 (Inherit) when no current model", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [makeModel("anthropic", "claude-sonnet")],
    });
    expect(state.selectedIndex).toBe(0);
    expect(state.selected()).toEqual({ kind: "inherit", key: "inherit" });
    expect(state.selection()).toEqual({ kind: "inherit" });
  });

  it("selects current model when it exists in the list", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [
        makeModel("anthropic", "claude-sonnet"),
        makeModel("openai", "gpt-5"),
      ],
      current: "openai/gpt-5",
    });
    // Pinned actions at 0,1; then models at 2,3
    expect(state.selectedIndex).toBe(3);
    expect(state.selected()?.key).toBe("openai/gpt-5");
  });

  it("current model takes precedence over inherit when model exists", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [makeModel("anthropic", "claude-sonnet")],
      current: "anthropic/claude-sonnet",
    });
    expect(state.selectedIndex).toBe(2); // after inherit(0) and manual(1)
    expect(state.selected()?.key).toBe("anthropic/claude-sonnet");
  });

  it("falls back to index 0 (Inherit) when current model not found", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [makeModel("anthropic", "claude-sonnet")],
      current: "openai/gpt-5",
    });
    expect(state.selectedIndex).toBe(0);
    expect(state.selected()).toEqual({ kind: "inherit", key: "inherit" });
  });

  it("falls back to index 0 when current is empty string", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [makeModel("anthropic", "claude-sonnet")],
      current: "",
    });
    expect(state.selectedIndex).toBe(0);
  });

  it("falls back to Inherit when current points to enabled-only model not in all", () => {
    const state = new ModelSelectorState({
      enabled: [makeModel("openai", "gpt-5")],
      all: [makeModel("anthropic", "claude-sonnet")],
      current: "openai/gpt-5",
    });
    // openai/gpt-5 is not in all, so it should not be selectable
    // Should fall back to Inherit
    expect(state.selectedIndex).toBe(0);
    expect(state.selected()).toEqual({ kind: "inherit", key: "inherit" });
  });

  it("current model in all is selected even if also in enabled", () => {
    const state = new ModelSelectorState({
      enabled: [makeModel("openai", "gpt-5")],
      all: [
        makeModel("anthropic", "claude-sonnet"),
        makeModel("openai", "gpt-5"),
      ],
      current: "openai/gpt-5",
    });
    expect(state.selected()?.key).toBe("openai/gpt-5");
  });
});

// ---------------------------------------------------------------------------
// setQuery filtering
// ---------------------------------------------------------------------------

describe("setQuery", () => {
  it("shows all items when query is empty", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [makeModel("anthropic", "claude-sonnet"), makeModel("openai", "gpt-5")],
    });
    expect(state.query).toBe("");
    expect(state.items).toHaveLength(4); // 2 pinned + 2 models
  });

  it("filters models by id (case-insensitive)", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [makeModel("anthropic", "claude-sonnet"), makeModel("openai", "gpt-5")],
    });
    state.setQuery("sonnet");
    const modelItems = state.items.filter((i) => i.kind === "model");
    expect(modelItems).toHaveLength(1);
    expect(modelItems[0].key).toBe("anthropic/claude-sonnet");
  });

  it("filters models by provider (case-insensitive)", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [makeModel("anthropic", "claude-sonnet"), makeModel("openai", "gpt-5")],
    });
    state.setQuery("OPENAI");
    const modelItems = state.items.filter((i) => i.kind === "model");
    expect(modelItems).toHaveLength(1);
    expect(modelItems[0].key).toBe("openai/gpt-5");
  });

  it("filters models by full provider/id (case-insensitive)", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [makeModel("anthropic", "claude-sonnet"), makeModel("openai", "gpt-5")],
    });
    state.setQuery("anthropic/claude");
    const modelItems = state.items.filter((i) => i.kind === "model");
    expect(modelItems).toHaveLength(1);
    expect(modelItems[0].key).toBe("anthropic/claude-sonnet");
  });

  it("filters models by display name (case-insensitive)", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [
        makeModel("anthropic", "claude-sonnet", "Claude Sonnet"),
        makeModel("openai", "gpt-5", "GPT-5"),
      ],
    });
    state.setQuery("Claude");
    const modelItems = state.items.filter((i) => i.kind === "model");
    expect(modelItems).toHaveLength(1);
    expect(modelItems[0].key).toBe("anthropic/claude-sonnet");
  });

  it("pinned actions always remain visible with search", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [makeModel("anthropic", "claude-sonnet"), makeModel("openai", "gpt-5")],
    });
    state.setQuery("zzznoMatch");
    const items = state.items;
    expect(items).toHaveLength(2); // inherit + manual
    expect(items[0].kind).toBe("inherit");
    expect(items[1].kind).toBe("manual");
  });

  it("enabled matching rows appear before non-enabled matching rows", () => {
    const state = new ModelSelectorState({
      enabled: [makeModel("openai", "gpt-5")],
      all: [
        makeModel("anthropic", "claude-sonnet"),
        makeModel("openai", "gpt-5"),
        makeModel("google", "gemini-pro"),
      ],
    });
    state.setQuery("gpt");
    const modelItems = state.items.filter((i) => i.kind === "model");
    expect(modelItems).toHaveLength(1);
    expect(modelItems[0].key).toBe("openai/gpt-5");
    expect(modelItems[0].enabled).toBe(true);
  });

  it("enabled non-matching rows are filtered out", () => {
    const state = new ModelSelectorState({
      enabled: [makeModel("openai", "gpt-5")],
      all: [
        makeModel("anthropic", "claude-sonnet"),
        makeModel("openai", "gpt-5"),
      ],
    });
    state.setQuery("claude");
    const modelItems = state.items.filter((i) => i.kind === "model");
    expect(modelItems).toHaveLength(1);
    expect(modelItems[0].key).toBe("anthropic/claude-sonnet");
    expect(modelItems[0].enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// setQuery selection behavior
// ---------------------------------------------------------------------------

describe("setQuery selection retention", () => {
  it("retains selection when the selected item is still visible after filtering", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [makeModel("anthropic", "claude-sonnet"), makeModel("openai", "gpt-5")],
    });
    // Move to the anthropic model
    state.move(1);
    state.move(1); // now at index 2 (anthropic/claude-sonnet)
    expect(state.selected()?.key).toBe("anthropic/claude-sonnet");

    // Filter to only show claude models
    state.setQuery("claude");
    expect(state.selected()?.key).toBe("anthropic/claude-sonnet");
  });

  it("resets to first matching model when selected item is filtered out", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [makeModel("anthropic", "claude-sonnet"), makeModel("openai", "gpt-5")],
    });
    // Move to the openai model
    state.move(1);
    state.move(1);
    state.move(1); // now at index 3 (openai/gpt-5)
    expect(state.selected()?.key).toBe("openai/gpt-5");

    // Filter to only show claude models
    state.setQuery("claude");
    expect(state.selected()?.key).toBe("anthropic/claude-sonnet");
  });

  it("resets to first matching model when selected item is filtered out (non-zero query)", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [makeModel("anthropic", "claude-sonnet"), makeModel("openai", "gpt-5")],
    });
    // Move to openai model
    state.move(1);
    state.move(1);
    state.move(1);
    // Filter away
    state.setQuery("claude");
    // Should select first matching model (anthropic/claude-sonnet)
    expect(state.selected()?.key).toBe("anthropic/claude-sonnet");
  });

  it("selects inherit when clearing query and current model not set", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [makeModel("anthropic", "claude-sonnet")],
    });
    state.setQuery("claude");
    // Now selected is anthropic/claude-sonnet
    state.setQuery("");
    // Should reset to inherit (index 0) since no current model
    expect(state.selectedIndex).toBe(0);
    expect(state.selected()?.kind).toBe("inherit");
  });

  it("selects current model when clearing query and current model exists", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [makeModel("anthropic", "claude-sonnet"), makeModel("openai", "gpt-5")],
      current: "openai/gpt-5",
    });
    state.setQuery("claude");
    // Now selected is anthropic/claude-sonnet
    state.setQuery("");
    // Should reset to current model
    expect(state.selected()?.key).toBe("openai/gpt-5");
  });

  it("no match: only pinned actions, selection stays on a pinned action", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [makeModel("anthropic", "claude-sonnet")],
    });
    state.setQuery("zzznoMatch");
    const items = state.items;
    expect(items).toHaveLength(2);
    // Selection should be on a valid index (either inherit or manual)
    expect(state.selectedIndex).toBeGreaterThanOrEqual(0);
    expect(state.selectedIndex).toBeLessThan(items.length);
    const sel = state.selected();
    expect(sel).toBeDefined();
    expect(sel!.kind === "inherit" || sel!.kind === "manual").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

describe("move", () => {
  it("moves down by 1", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [makeModel("anthropic", "claude-sonnet")],
    });
    expect(state.selectedIndex).toBe(0);
    state.move(1);
    expect(state.selectedIndex).toBe(1);
    expect(state.selected()?.kind).toBe("manual");
  });

  it("moves up by 1", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [makeModel("anthropic", "claude-sonnet")],
    });
    // Move to manual first
    state.move(1);
    expect(state.selectedIndex).toBe(1);
    state.move(-1);
    expect(state.selectedIndex).toBe(0);
    expect(state.selected()?.kind).toBe("inherit");
  });

  it("wraps around from last to first", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [makeModel("anthropic", "claude-sonnet")],
    });
    const lastIndex = state.items.length - 1;
    // Move to last
    while (state.selectedIndex < lastIndex) {
      state.move(1);
    }
    expect(state.selectedIndex).toBe(lastIndex);
    // Wrap around
    state.move(1);
    expect(state.selectedIndex).toBe(0);
  });

  it("wraps around from first to last", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [makeModel("anthropic", "claude-sonnet")],
    });
    expect(state.selectedIndex).toBe(0);
    state.move(-1);
    expect(state.selectedIndex).toBe(state.items.length - 1);
  });

  it("wraps correctly with filtered items", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [makeModel("anthropic", "claude-sonnet"), makeModel("openai", "gpt-5")],
    });
    state.setQuery("claude");
    // Items: inherit(0), manual(1), anthropic/claude-sonnet(2)
    expect(state.items).toHaveLength(3);
    // Move to last
    state.move(1);
    state.move(1); // index 2
    expect(state.selectedIndex).toBe(2);
    // Wrap
    state.move(1);
    expect(state.selectedIndex).toBe(0);
  });

  it("wraps correctly with only pinned actions (no model matches)", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [makeModel("anthropic", "claude-sonnet")],
    });
    state.setQuery("zzznoMatch");
    expect(state.items).toHaveLength(2);
    state.move(1);
    expect(state.selectedIndex).toBe(1);
    state.move(1);
    expect(state.selectedIndex).toBe(0);
    state.move(-1);
    expect(state.selectedIndex).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// selection() return values
// ---------------------------------------------------------------------------

describe("selection", () => {
  it("returns inherit selection", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [makeModel("anthropic", "claude-sonnet")],
    });
    expect(state.selection()).toEqual({ kind: "inherit" });
  });

  it("returns manual selection", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [makeModel("anthropic", "claude-sonnet")],
    });
    state.move(1);
    expect(state.selection()).toEqual({ kind: "manual" });
  });

  it("returns model selection with full provider/id", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [makeModel("anthropic", "claude-sonnet")],
    });
    state.move(1);
    state.move(1);
    expect(state.selection()).toEqual({
      kind: "model",
      value: "anthropic/claude-sonnet",
    });
  });


});

// ---------------------------------------------------------------------------
// Immutability & defensive state
// ---------------------------------------------------------------------------

describe("immutability", () => {
  it("query returns current query string", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [makeModel("anthropic", "claude-sonnet")],
    });
    expect(state.query).toBe("");
    state.setQuery("test");
    expect(state.query).toBe("test");
  });

  it("items returns a fresh array each call (caller cannot splice internal)", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [makeModel("anthropic", "claude-sonnet")],
    });
    const a = state.items;
    const b = state.items;
    // Fresh snapshots: different array objects
    expect(a).not.toBe(b);
    // But same content
    expect(a).toEqual(b);
    // Mutating the returned snapshot does not affect state
    const lenBefore = state.items.length;
    (a as ModelSelectorItem[]).splice(0, a.length);
    expect(state.items).toHaveLength(lenBefore);
  });

  it("mutating original descriptor objects after construction does not affect state", () => {
    const originalModel = makeModel("anthropic", "claude-sonnet", "Claude Sonnet");
    const state = new ModelSelectorState({
      enabled: [],
      all: [originalModel],
    });
    // Mutate the original descriptor
    originalModel.name = "Hacked Name";
    originalModel.provider = "evil";
    originalModel.id = "backdoor";
    // State must be unaffected
    const modelItems = state.items.filter((i) => i.kind === "model");
    expect(modelItems).toHaveLength(1);
    expect(modelItems[0].model.name).toBe("Claude Sonnet");
    expect(modelItems[0].model.provider).toBe("anthropic");
    expect(modelItems[0].model.id).toBe("claude-sonnet");
    expect(modelItems[0].key).toBe("anthropic/claude-sonnet");
  });

  it("mutating original enabled array after construction does not affect state", () => {
    const enabled = [makeModel("openai", "gpt-5")];
    const all = [makeModel("openai", "gpt-5"), makeModel("anthropic", "claude")];
    const state = new ModelSelectorState({ enabled, all });
    // Mutate original arrays
    enabled.length = 0;
    all.length = 0;
    // State must be unaffected
    expect(state.items.filter((i) => i.kind === "model")).toHaveLength(2);
    expect(state.items.filter((i) => i.kind === "model" && i.enabled)).toHaveLength(1);
  });

  it("mutating original all array after construction does not affect state", () => {
    const all = [makeModel("anthropic", "claude-sonnet")];
    const state = new ModelSelectorState({
      enabled: [],
      all,
    });
    // Mutate original array
    all.push(makeModel("evil", "injected"));
    // State must be unaffected
    const modelItems = state.items.filter((i) => i.kind === "model");
    expect(modelItems).toHaveLength(1);
    expect(modelItems[0].key).toBe("anthropic/claude-sonnet");
  });

  it("mutating model descriptor through state.items[i].model throws in strict mode", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [makeModel("anthropic", "claude-sonnet", "Claude Sonnet")],
    });
    const items = state.items;
    const modelItem = items.find((i) => i.kind === "model")!;
    expect(modelItem).toBeDefined();
    // Cast to escape readonly and attempt mutation in strict mode
    const model = modelItem.model as ModelDescriptor;
    expect(() => {
      "use strict";
      model.name = "Hacked";
    }).toThrow(TypeError);
    expect(() => {
      "use strict";
      model.provider = "evil";
    }).toThrow(TypeError);
    expect(() => {
      "use strict";
      model.id = "backdoor";
    }).toThrow(TypeError);
    // Verify original values are intact
    expect(modelItem.model.name).toBe("Claude Sonnet");
    expect(modelItem.model.provider).toBe("anthropic");
    expect(modelItem.model.id).toBe("claude-sonnet");
  });

  it("mutating selected() model descriptor throws in strict mode", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [makeModel("anthropic", "claude-sonnet", "Claude Sonnet")],
    });
    // Move to the model item (index 2)
    state.move(1);
    state.move(1);
    const sel = state.selected()!;
    expect(sel.kind).toBe("model");
    const model = (sel as Extract<ModelSelectorItem, { kind: "model" }>).model as ModelDescriptor;
    expect(() => {
      "use strict";
      model.name = "Hacked";
    }).toThrow(TypeError);
    expect(() => {
      "use strict";
      model.provider = "evil";
    }).toThrow(TypeError);
    expect(() => {
      "use strict";
      model.id = "backdoor";
    }).toThrow(TypeError);
    // Verify original values are intact
    const selAgain = state.selected() as Extract<ModelSelectorItem, { kind: "model" }>;
    expect(selAgain.model.name).toBe("Claude Sonnet");
    expect(selAgain.model.provider).toBe("anthropic");
    expect(selAgain.model.id).toBe("claude-sonnet");
  });

  it("mutating selected() pinned action throws in strict mode", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [makeModel("anthropic", "claude-sonnet")],
    });
    // selectedIndex defaults to 0 (inherit)
    const sel = state.selected()!;
    expect(sel.kind).toBe("inherit");
    const cast = sel as { kind: string; key: string };
    expect(() => {
      "use strict";
      cast.kind = "manual";
    }).toThrow(TypeError);
    expect(() => {
      "use strict";
      cast.key = "hacked";
    }).toThrow(TypeError);
    // Verify original values are intact
    expect(sel.kind).toBe("inherit");
    expect(sel.key).toBe("inherit");
  });

  it("casting returned items array and splicing does not affect internal state", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [makeModel("anthropic", "claude-sonnet"), makeModel("openai", "gpt-5")],
    });
    const items = state.items as ModelSelectorItem[];
    // Try to splice/mutate
    items.splice(0, items.length);
    items.push({ kind: "manual", key: "manual" } as ModelSelectorItem);
    // State must be intact
    expect(state.items).toHaveLength(4); // 2 pinned + 2 models
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  it("model with empty name is still filterable by id and provider", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [makeModel("anthropic", "claude-sonnet")],
    });
    state.setQuery("anthropic");
    expect(state.items.filter((i) => i.kind === "model")).toHaveLength(1);
    state.setQuery("");
    state.setQuery("claude");
    expect(state.items.filter((i) => i.kind === "model")).toHaveLength(1);
  });

  it("enabled models matching search appear before non-enabled matching", () => {
    const state = new ModelSelectorState({
      enabled: [makeModel("openai", "gpt-5")],
      all: [
        makeModel("anthropic", "claude-sonnet"),
        makeModel("openai", "gpt-5"),
        makeModel("openai", "gpt-4"),
      ],
    });
    state.setQuery("gpt");
    const modelItems = state.items.filter((i) => i.kind === "model");
    expect(modelItems).toHaveLength(2);
    expect(modelItems[0].key).toBe("openai/gpt-5");
    expect(modelItems[0].enabled).toBe(true);
    expect(modelItems[1].key).toBe("openai/gpt-4");
    expect(modelItems[1].enabled).toBe(false);
  });

  it("defensively ignores malformed descriptors with empty id", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [{ provider: "test", id: "" } as ModelDescriptor],
    });
    const modelItems = state.items.filter((i) => i.kind === "model");
    expect(modelItems).toHaveLength(0);
  });

  it("defensively ignores malformed descriptors with empty provider", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [{ provider: "", id: "test" } as ModelDescriptor],
    });
    const modelItems = state.items.filter((i) => i.kind === "model");
    expect(modelItems).toHaveLength(0);
  });

  // -------------------------------------------------------------------
  // Nested-slash model IDs (e.g. openrouter/openai/gpt-5.6-sol)
  // -------------------------------------------------------------------

  it("handles model IDs with nested slashes in all", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [
        makeModel("openrouter", "openai/gpt-5.6-sol"),
        makeModel("anthropic", "claude-sonnet"),
      ],
    });
    const modelItems = state.items.filter((i) => i.kind === "model");
    expect(modelItems).toHaveLength(2);
    // Sorted by provider: anthropic < openrouter
    expect(modelItems[0].key).toBe("anthropic/claude-sonnet");
    expect(modelItems[0].model.provider).toBe("anthropic");
    expect(modelItems[1].key).toBe("openrouter/openai/gpt-5.6-sol");
    expect(modelItems[1].model.provider).toBe("openrouter");
    expect(modelItems[1].model.id).toBe("openai/gpt-5.6-sol");
  });

  it("search matches nested-slash model IDs by full key", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [
        makeModel("openrouter", "openai/gpt-5.6-sol"),
        makeModel("anthropic", "claude-sonnet"),
      ],
    });
    state.setQuery("openrouter/openai");
    const modelItems = state.items.filter((i) => i.kind === "model");
    expect(modelItems).toHaveLength(1);
    expect(modelItems[0].key).toBe("openrouter/openai/gpt-5.6-sol");
  });

  it("search matches nested-slash model IDs by id segment", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [
        makeModel("openrouter", "openai/gpt-5.6-sol"),
        makeModel("anthropic", "claude-sonnet"),
      ],
    });
    state.setQuery("gpt-5.6");
    const modelItems = state.items.filter((i) => i.kind === "model");
    expect(modelItems).toHaveLength(1);
    expect(modelItems[0].key).toBe("openrouter/openai/gpt-5.6-sol");
  });

  it("selection with nested-slash ID returns correct full key", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [
        makeModel("openrouter", "openai/gpt-5.6-sol"),
        makeModel("anthropic", "claude-sonnet"),
      ],
    });
    // Sorted: anthropic/claude-sonnet (index 2), openrouter/openai/gpt-5.6-sol (index 3)
    // Move past inherit(0), manual(1), first model(2) to second model(3)
    state.move(1);
    state.move(1);
    state.move(1);
    const sel = state.selection();
    expect(sel).toEqual({
      kind: "model",
      value: "openrouter/openai/gpt-5.6-sol",
    });
  });

  it("current model with nested-slash ID is correctly selected", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [
        makeModel("openrouter", "openai/gpt-5.6-sol"),
        makeModel("anthropic", "claude-sonnet"),
      ],
      current: "openrouter/openai/gpt-5.6-sol",
    });
    expect(state.selected()?.key).toBe("openrouter/openai/gpt-5.6-sol");
  });

  it("enabled nested-slash model appears before non-enabled in search", () => {
    const state = new ModelSelectorState({
      enabled: [makeModel("openrouter", "openai/gpt-5.6-sol")],
      all: [
        makeModel("openrouter", "openai/gpt-5.6-sol"),
        makeModel("openrouter", "openai/gpt-4"),
      ],
    });
    state.setQuery("openai");
    const modelItems = state.items.filter((i) => i.kind === "model");
    expect(modelItems).toHaveLength(2);
    expect(modelItems[0].key).toBe("openrouter/openai/gpt-5.6-sol");
    expect(modelItems[0].enabled).toBe(true);
    expect(modelItems[1].key).toBe("openrouter/openai/gpt-4");
    expect(modelItems[1].enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Deterministic ordering (code-point, not localeCompare)
// ---------------------------------------------------------------------------

describe("deterministic ordering", () => {
  it("sorts by code-point order: uppercase before lowercase (A < a)", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [
        makeModel("a-provider", "z-id"),
        makeModel("A-provider", "a-id"),
      ],
    });
    const modelItems = state.items.filter((i) => i.kind === "model");
    const keys = modelItems.map((i) => i.key);
    // Code-point: 'A' (65) < 'a' (97), so A-provider comes first
    expect(keys).toEqual(["A-provider/a-id", "a-provider/z-id"]);
  });

  it("sorts accented characters by code-point (not collation)", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [
        makeModel("z-provider", "model"),
        makeModel("\u00E1-provider", "model"), // á (U+00E1, code 225)
        makeModel("a-provider", "model"),
      ],
    });
    const modelItems = state.items.filter((i) => i.kind === "model");
    const keys = modelItems.map((i) => i.key);
    // Code-point: 'a' (97) < 'z' (122) < 'á' (225)
    expect(keys).toEqual([
      "a-provider/model",
      "z-provider/model",
      "\u00E1-provider/model",
    ]);
  });

  it("sorts mixed-case provider names consistently", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [
        makeModel("OpenAI", "gpt-5"),
        makeModel("Anthropic", "claude-sonnet"),
        makeModel("openai", "gpt-4"),
        makeModel("anthropic", "claude-opus"),
      ],
    });
    const modelItems = state.items.filter((i) => i.kind === "model");
    const keys = modelItems.map((i) => i.key);
    // Code-point: 'A' (65) < 'O' (79) < 'a' (97) < 'o' (111)
    expect(keys).toEqual([
      "Anthropic/claude-sonnet",
      "OpenAI/gpt-5",
      "anthropic/claude-opus",
      "openai/gpt-4",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Unicode search normalization
// ---------------------------------------------------------------------------

describe("unicode search normalization", () => {
  it("matches composed and decomposed forms of the same character", () => {
    // é as U+00E9 (precomposed) vs e + U+0301 (decomposed)
    const state = new ModelSelectorState({
      enabled: [],
      all: [
        makeModel("caf\u00E9-provider", "latte"), // composed é
      ],
    });
    // Search with decomposed form
    state.setQuery("cafe\u0301"); // e + combining acute
    const modelItems = state.items.filter((i) => i.kind === "model");
    expect(modelItems).toHaveLength(1);
    expect(modelItems[0].key).toBe("caf\u00E9-provider/latte");
  });

  it("NFKC normalizes compatibility characters (fullwidth to ASCII)", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [
        makeModel("openai", "gpt-5"),
      ],
    });
    // Fullwidth 'ｏｐｅｎａｉ' (U+FF4F etc.) should match via NFKC
    state.setQuery("\uFF4F\uFF50\uFF45\uFF4E\uFF41\uFF49");
    const modelItems = state.items.filter((i) => i.kind === "model");
    expect(modelItems).toHaveLength(1);
    expect(modelItems[0].key).toBe("openai/gpt-5");
  });

  it("search is case-insensitive with fixed en-US locale", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [
        makeModel("anthropic", "claude-sonnet"),
      ],
    });
    state.setQuery("CLAUDE");
    expect(state.items.filter((i) => i.kind === "model")).toHaveLength(1);
    state.setQuery("");
    state.setQuery("claude");
    expect(state.items.filter((i) => i.kind === "model")).toHaveLength(1);
  });

  it("search is NOT accent-insensitive (accented vs unaccented are distinct)", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [
        makeModel("caf\u00E9-provider", "latte"),
      ],
    });
    // Plain "cafe" without accent should NOT match "café"
    state.setQuery("cafe");
    const modelItems = state.items.filter((i) => i.kind === "model");
    expect(modelItems).toHaveLength(0);
  });

  it("matches provider name with accented characters in query", () => {
    const state = new ModelSelectorState({
      enabled: [],
      all: [
        makeModel("caf\u00E9-provider", "latte"),
      ],
    });
    // Search with the same composed form
    state.setQuery("caf\u00E9");
    const modelItems = state.items.filter((i) => i.kind === "model");
    expect(modelItems).toHaveLength(1);
    expect(modelItems[0].key).toBe("caf\u00E9-provider/latte");
  });
});