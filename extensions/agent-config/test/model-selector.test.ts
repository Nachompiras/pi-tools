import { describe, expect, it, vi, beforeEach } from "vitest";
import { SearchableModelSelector } from "../src/model-selector.js";
import { showSearchableModelSelector, buildSelectorTheme } from "../src/ui-adapter.js";
import type { ModelDescriptor, ModelSelection } from "../src/types.js";
import { Input, KeybindingsManager, setKeybindings, TUI_KEYBINDINGS, CURSOR_MARKER } from "@earendil-works/pi-tui";
import type { TUI, Component } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";
import { Theme } from "@earendil-works/pi-coding-agent";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

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

function makeModels(
  count: number,
  prefix = "provider",
): ModelDescriptor[] {
  return Array.from({ length: count }, (_, i) =>
    makeModel(prefix, `model-${i + 1}`, `Model ${i + 1}`),
  );
}

/** Minimal theme matching the structural shape pi-tui components expect */
function makeTheme() {
  return {
    // SelectList-like theme colors
    selectedPrefix: (text: string) => `\x1b[7m${text}\x1b[27m`,
    selectedText: (text: string) => `\x1b[7m${text}\x1b[27m`,
    description: (text: string) => `\x1b[2m${text}\x1b[22m`,
    scrollInfo: (text: string) => `\x1b[2m${text}\x1b[22m`,
    noMatch: (text: string) => `\x1b[2m${text}\x1b[22m`,
    // Additional theme helpers for model selector
    title: (text: string) => `\x1b[1m${text}\x1b[22m`,
    hint: (text: string) => `\x1b[2m${text}\x1b[22m`,
    enabledMarker: (text: string) => `\x1b[32m${text}\x1b[39m`,
    provider: (text: string) => `\x1b[2m${text}\x1b[22m`,
  };
}

function makeSelector(
  overrides: {
    enabled?: ModelDescriptor[];
    all?: ModelDescriptor[];
    current?: string;
    onSelect?: (selection: ModelSelection) => void;
    onCancel?: () => void;
    requestRender?: () => void;
    theme?: ReturnType<typeof makeTheme>;
    keybindings?: KeybindingsManager;
  } = {},
): SearchableModelSelector {
  const {
    enabled = [],
    all = [],
    current,
    onSelect = () => {},
    onCancel = () => {},
    requestRender = () => {},
    theme = makeTheme(),
    keybindings = new KeybindingsManager(TUI_KEYBINDINGS),
  } = overrides;

  return new SearchableModelSelector(
    {
      enabled,
      all,
      current,
      onSelect,
      onCancel,
      requestRender,
    },
    theme,
    keybindings,
  );
}

/**
 * Type-narrowing assertion: ensures a Component has handleInput before use.
 * The Component interface declares handleInput as optional, but all concrete
 * components produced by the factory (SearchableModelSelector) implement it.
 * Using this assertion avoids scattered non-null `!` or `as any` casts.
 */
function assertHasHandleInput(
  comp: Component,
): asserts comp is Component & { handleInput(data: string): void } {
  if (!comp.handleInput) {
    throw new Error("Component missing handleInput");
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SearchableModelSelector", () => {
  // Reset keybindings before each test
  beforeEach(() => {
    setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS));
  });

  // -----------------------------------------------------------------------
  // Construction & basic rendering
  // -----------------------------------------------------------------------

  describe("construction", () => {
    it("creates with empty model list", () => {
      const selector = makeSelector();
      expect(selector).toBeDefined();
      expect(selector.focused).toBe(false);
    });

    it("creates with models", () => {
      const selector = makeSelector({
        all: [makeModel("anthropic", "claude-sonnet")],
      });
      expect(selector).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  describe("render", () => {
    it("returns an array of strings", () => {
      const selector = makeSelector({
        all: [makeModel("anthropic", "claude-sonnet")],
      });
      const lines = selector.render(80);
      expect(Array.isArray(lines)).toBe(true);
      expect(lines.length).toBeGreaterThan(0);
      lines.forEach((line) => expect(typeof line).toBe("string"));
    });

    it("renders title 'Configure agent model'", () => {
      const selector = makeSelector({
        all: [makeModel("anthropic", "claude-sonnet")],
      });
      const lines = selector.render(80);
      // Find a line containing the title
      const titleLine = lines.find((l) => l.includes("Configure agent model"));
      expect(titleLine).toBeDefined();
    });

    it("includes search input area", () => {
      const selector = makeSelector({
        all: [makeModel("anthropic", "claude-sonnet")],
      });
      const lines = selector.render(80);
      const hasInput = lines.some(
        (l) => l.includes("Search") || l.includes(":") || l.includes(">"),
      );
      expect(hasInput).toBe(true);
    });

    it("renders pinned actions 'Inherit (use default)' and 'Enter model manually...'", () => {
      const selector = makeSelector({
        all: [makeModel("anthropic", "claude-sonnet")],
      });
      const lines = selector.render(80);
      const hasInherit = lines.some((l) => l.includes("Inherit"));
      const hasManual = lines.some((l) => l.includes("Enter model manually"));
      expect(hasInherit).toBe(true);
      expect(hasManual).toBe(true);
    });

    it("renders model rows with model id and provider", () => {
      const selector = makeSelector({
        all: [makeModel("anthropic", "claude-sonnet", "Claude Sonnet")],
      });
      const lines = selector.render(80);
      const hasModelId = lines.some((l) => l.includes("claude-sonnet"));
      const hasProvider = lines.some((l) => l.includes("anthropic"));
      expect(hasModelId).toBe(true);
      expect(hasProvider).toBe(true);
    });

    it("renders no-results message when filter matches nothing", () => {
      const selector = makeSelector({
        all: [makeModel("anthropic", "claude-sonnet")],
      });
      // Simulate filtering by typing into the search input
      selector.handleInput("z");
      selector.handleInput("z");
      selector.handleInput("z");
      const lines = selector.render(80);
      const hasNoResults = lines.some(
        (l) => l.includes("No") || l.includes("match") || l.includes("result"),
      );
      expect(hasNoResults).toBe(true);
    });

    it("renders footer hints with arrows/enter/esc", () => {
      const selector = makeSelector({
        all: [makeModel("anthropic", "claude-sonnet")],
      });
      const lines = selector.render(80);
      const hasArrows = lines.some(
        (l) => l.includes("navigate") || l.includes("select") || l.includes("cancel"),
      );
      expect(hasArrows).toBe(true);
    });

    it("all visible line widths are <= provided width", () => {
      const selector = makeSelector({
        all: [
          makeModel("anthropic", "claude-sonnet"),
          makeModel("openai", "gpt-5"),
          makeModel("google", "gemini-pro"),
        ],
      });
      for (const width of [80, 60, 40, 30, 20]) {
        const lines = selector.render(width);
        for (const line of lines) {
          const w = visibleWidth(line);
          expect(w).toBeLessThanOrEqual(width);
        }
      }
    });

    // -------------------------------------------------------------------
    // Gap 1: Exact width - no MIN_WIDTH inflation
    // -------------------------------------------------------------------

    describe("exact width (no MIN_WIDTH inflation)", () => {
      it("renders at width 0: all lines visibleWidth <= 0", () => {
        const selector = makeSelector({
          all: [makeModel("anthropic", "claude-sonnet")],
        });
        const lines = selector.render(0);
        expect(lines.length).toBeGreaterThan(0);
        for (const line of lines) {
          expect(visibleWidth(line)).toBeLessThanOrEqual(0);
        }
      });

      it("renders at width 1: all lines visibleWidth <= 1", () => {
        const selector = makeSelector({
          all: [makeModel("anthropic", "claude-sonnet")],
        });
        const lines = selector.render(1);
        expect(lines.length).toBeGreaterThan(0);
        for (const line of lines) {
          expect(visibleWidth(line)).toBeLessThanOrEqual(1);
        }
      });

      it("renders at width 5: all lines visibleWidth <= 5", () => {
        const selector = makeSelector({
          all: [makeModel("anthropic", "claude-sonnet")],
        });
        const lines = selector.render(5);
        expect(lines.length).toBeGreaterThan(0);
        for (const line of lines) {
          expect(visibleWidth(line)).toBeLessThanOrEqual(5);
        }
      });

      it("renders at width 11: all lines visibleWidth <= 11", () => {
        const selector = makeSelector({
          all: [makeModel("anthropic", "claude-sonnet")],
        });
        const lines = selector.render(11);
        expect(lines.length).toBeGreaterThan(0);
        for (const line of lines) {
          expect(visibleWidth(line)).toBeLessThanOrEqual(11);
        }
      });

      it("does not inflate width 5 to a higher minimum", () => {
        const selector = makeSelector({
          all: [makeModel("anthropic", "claude-sonnet")],
        });
        const lines = selector.render(5);
        // With MIN_WIDTH=12 removed, width 5 should produce narrow lines
        // All lines must be strictly within 5
        for (const line of lines) {
          expect(visibleWidth(line)).toBeLessThanOrEqual(5);
        }
        // Width 5 should produce different output than width 12
        const lines12 = selector.render(12);
        expect(lines).not.toEqual(lines12);
      });
    });

    it("renders at narrow width (20) without crashing", () => {
      const selector = makeSelector({
        all: [
          makeModel("anthropic", "claude-sonnet"),
          makeModel("openai", "gpt-5"),
        ],
      });
      const lines = selector.render(20);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(20);
      }
    });

    it("renders scroll indicator when items exceed viewport", () => {
      const selector = makeSelector({
        all: makeModels(30),
      });
      const lines = selector.render(80);
      const hasScrollInfo = lines.some(
        (l) => l.includes("/") || l.includes("more") || l.includes("items"),
      );
      expect(hasScrollInfo).toBe(true);
    });

    it("enabled model rows show an enabled marker", () => {
      const selector = makeSelector({
        enabled: [makeModel("anthropic", "claude-sonnet")],
        all: [
          makeModel("anthropic", "claude-sonnet"),
          makeModel("openai", "gpt-5"),
        ],
      });
      const lines = selector.render(80);
      const hasEnabled = lines.some(
        (l) => l.includes("✓") || l.includes("✔") || l.includes("[x]") || l.includes("enabled") || l.includes("active"),
      );
      expect(hasEnabled).toBe(true);
    });

    // -------------------------------------------------------------------
    // Gap 2: Truly pinned actions
    // -------------------------------------------------------------------

    it("pinned actions remain visible when navigating deep into model list", () => {
      const selector = makeSelector({
        all: makeModels(30),
      });
      // Navigate deep: move past pinned actions (2) and deep into models
      for (let i = 0; i < 20; i++) {
        selector.handleInput("\x1b[B"); // down
      }
      const lines = selector.render(80);
      const hasInherit = lines.some((l) => l.includes("Inherit"));
      const hasManual = lines.some((l) => l.includes("Enter model manually"));
      expect(hasInherit).toBe(true);
      expect(hasManual).toBe(true);
    });

    it("pinned actions are not duplicated in the model viewport", () => {
      const selector = makeSelector({
        all: makeModels(30),
      });
      const lines = selector.render(80);
      const inheritCount = lines.filter((l) => l.includes("Inherit")).length;
      const manualCount = lines.filter((l) => l.includes("Enter model manually")).length;
      expect(inheritCount).toBe(1);
      expect(manualCount).toBe(1);
    });

    it("selected model is visible when navigating deep", () => {
      const selector = makeSelector({
        all: makeModels(30),
        current: "provider/model-5",
      });
      // Navigate deep into the model list
      for (let i = 0; i < 15; i++) {
        selector.handleInput("\x1b[B"); // down
      }
      const lines = selector.render(80);
      // The selected model must be visible (use selectedText styling as proof)
      const hasSelectedModel = lines.some(
        (l) => l.includes("\x1b[7m") && l.includes("model-"),
      );
      expect(hasSelectedModel).toBe(true);
    });

    it("scroll indicator shows model-only count, not total", () => {
      const selector = makeSelector({
        all: makeModels(30),
      });
      // Scroll to bottom
      for (let i = 0; i < 31; i++) {
        selector.handleInput("\x1b[B"); // down
      }
      const lines = selector.render(80);
      const scrollLine = lines.find((l) => l.includes("/"));
      expect(scrollLine).toBeDefined();
      // Model count should be 30, not 32 (which would include pinned)
      if (scrollLine) {
        expect(scrollLine).toMatch(/30/);
      }
    });

    it("scroll indicator shows correct position when on a pinned action", () => {
      const selector = makeSelector({
        all: makeModels(20),
      });
      // Default is Inherit (pinned action at index 0)
      const lines = selector.render(80);
      const scrollLine = lines.find((l) => l.includes("/"));
      if (scrollLine) {
        // When on a pinned action, scroll shows model position 0+1 = 1/20
        expect(scrollLine).toMatch(/1\/20/);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Input handling: printable characters and backspace
  // -----------------------------------------------------------------------

  describe("handleInput - printable", () => {
    it("delegates printable characters to the embedded Input", () => {
      const selector = makeSelector({
        all: [makeModel("anthropic", "claude-sonnet")],
      });
      const input = selector.getSearchInput();
      expect(input.getValue()).toBe("");

      selector.handleInput("a");
      expect(input.getValue()).toBe("a");
    });

    it("delegates backspace to the embedded Input", () => {
      const selector = makeSelector({
        all: [makeModel("anthropic", "claude-sonnet")],
      });
      const input = selector.getSearchInput();

      selector.handleInput("a");
      selector.handleInput("b");
      expect(input.getValue()).toBe("ab");

      // backspace removes last char
      selector.handleInput("\x7f"); // DEL
      expect(input.getValue()).toBe("a");
    });

    it("updates internal state with query after input delegation", () => {
      const selector = makeSelector({
        all: [
          makeModel("anthropic", "claude-sonnet"),
          makeModel("openai", "gpt-5"),
        ],
      });
      selector.handleInput("c");
      selector.handleInput("l");
      selector.handleInput("a");
      selector.handleInput("u");
      selector.handleInput("d");
      selector.handleInput("e");

      // After filtering, the view should show the claude model
      const lines = selector.render(80);
      const hasClaude = lines.some((l) => l.includes("claude-sonnet"));
      const hasGpt = lines.some((l) => l.includes("gpt-5"));
      expect(hasClaude).toBe(true);
      expect(hasGpt).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Input handling: navigation
  // -----------------------------------------------------------------------

  describe("handleInput - navigation", () => {
    it("moves selection down with tui.select.down", () => {
      const kb = new KeybindingsManager(TUI_KEYBINDINGS);
      setKeybindings(kb);
      const selector = makeSelector({
        all: [makeModel("anthropic", "claude-sonnet")],
        keybindings: kb,
      });

      // Default selection is 0 (Inherit)
      // Move down
      selector.handleInput("\x1b[B"); // ANSI escape for down arrow
      const render = selector.render(80);
      expect(render.length).toBeGreaterThan(0);
    });

    it("moves selection up with tui.select.up", () => {
      const kb = new KeybindingsManager(TUI_KEYBINDINGS);
      setKeybindings(kb);
      const selector = makeSelector({
        all: [makeModel("anthropic", "claude-sonnet")],
        keybindings: kb,
      });

      // First move down
      selector.handleInput("\x1b[B"); // down
      // Then move up
      selector.handleInput("\x1b[A"); // up
      const render = selector.render(80);
      expect(render.length).toBeGreaterThan(0);
    });

    it("enter invokes onSelect with current selection", () => {
      const onSelect = vi.fn();
      const selector = makeSelector({
        all: [makeModel("anthropic", "claude-sonnet")],
        onSelect,
      });

      // Default selection is Inherit
      selector.handleInput("\r"); // Enter
      expect(onSelect).toHaveBeenCalledWith({ kind: "inherit" });
    });

    it("enter invokes onSelect with model when a model is selected", () => {
      const onSelect = vi.fn();
      const selector = makeSelector({
        all: [makeModel("anthropic", "claude-sonnet")],
        onSelect,
      });

      // Move down twice to get to the model (after inherit, manual)
      selector.handleInput("\x1b[B"); // down
      selector.handleInput("\x1b[B"); // down
      // Now should be on the model
      selector.handleInput("\r"); // Enter
      expect(onSelect).toHaveBeenCalledWith({
        kind: "model",
        value: "anthropic/claude-sonnet",
      });
    });

    it("enter on 'Enter model manually...' invokes onSelect with manual kind", () => {
      const onSelect = vi.fn();
      const selector = makeSelector({
        all: [makeModel("anthropic", "claude-sonnet")],
        onSelect,
      });

      // Move down once to get to manual
      selector.handleInput("\x1b[B"); // down
      selector.handleInput("\r"); // Enter
      expect(onSelect).toHaveBeenCalledWith({ kind: "manual" });
    });

    it("escape invokes onCancel", () => {
      const onCancel = vi.fn();
      const selector = makeSelector({
        all: [makeModel("anthropic", "claude-sonnet")],
        onCancel,
      });

      selector.handleInput("\x1b"); // Escape
      expect(onCancel).toHaveBeenCalledOnce();
    });

    it("ctrl+c invokes onCancel", () => {
      const onCancel = vi.fn();
      const selector = makeSelector({
        all: [makeModel("anthropic", "claude-sonnet")],
        onCancel,
      });

      selector.handleInput("\x03"); // Ctrl+C
      expect(onCancel).toHaveBeenCalledOnce();
    });

    // -------------------------------------------------------------------
    // Gap 4: Prove selection via selected styling
    // -------------------------------------------------------------------

    it("selected item uses selectedText theme styling", () => {
      const selector = makeSelector({
        all: [makeModel("anthropic", "claude-sonnet")],
      });
      const lines = selector.render(80);
      // Find the selected line (Inherit, index 0)
      const selectedLine = lines.find((l) => l.includes("Inherit") && l.includes("\x1b[7m"));
      expect(selectedLine).toBeDefined();
    });

    it("non-selected items do not have selectedText styling", () => {
      const selector = makeSelector({
        all: [makeModel("anthropic", "claude-sonnet")],
      });
      const lines = selector.render(80);
      // The manual line (index 1) should not be selected
      const manualLine = lines.find((l) => l.includes("Enter model manually") && !l.includes("\x1b[7m"));
      expect(manualLine).toBeDefined();
    });

    it("selectedPrefix theme is applied to the arrow prefix", () => {
      const selector = makeSelector({
        all: [makeModel("anthropic", "claude-sonnet")],
      });
      const lines = selector.render(80);
      const selectedLine = lines.find((l) => l.includes("Inherit"));
      expect(selectedLine).toBeDefined();
      // The arrow prefix should be separately styled: the selectedPrefix ANSI sequence
      // should appear in the line (wrapping the arrow "→")
      if (selectedLine) {
        expect(selectedLine).toContain("\x1b[7m→\x1b[27m");
      }
    });
  });

  // -----------------------------------------------------------------------
  // requestRender
  // -----------------------------------------------------------------------

  describe("requestRender", () => {
    it("calls requestRender after input", () => {
      const requestRender = vi.fn();
      const selector = makeSelector({
        all: [makeModel("anthropic", "claude-sonnet")],
        requestRender,
      });

      selector.handleInput("a");
      expect(requestRender).toHaveBeenCalled();
    });

    it("calls requestRender after navigation", () => {
      const requestRender = vi.fn();
      const selector = makeSelector({
        all: [makeModel("anthropic", "claude-sonnet")],
        requestRender,
      });

      requestRender.mockClear();
      selector.handleInput("\x1b[B"); // down
      expect(requestRender).toHaveBeenCalled();
    });

    it("calls requestRender after escape", () => {
      const requestRender = vi.fn();
      const selector = makeSelector({
        all: [makeModel("anthropic", "claude-sonnet")],
        requestRender,
      });

      requestRender.mockClear();
      selector.handleInput("\x1b"); // escape
      expect(requestRender).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Focus
  // -----------------------------------------------------------------------

  describe("focus", () => {
    it("propagates focus to embedded Input", () => {
      const selector = makeSelector({
        all: [makeModel("anthropic", "claude-sonnet")],
      });

      const input = selector.getSearchInput();
      expect(input.focused).toBe(false);

      selector.focused = true;
      expect(input.focused).toBe(true);

      selector.focused = false;
      expect(input.focused).toBe(false);
    });

    it("getSearchInput returns the embedded Input", () => {
      const selector = makeSelector();
      const input = selector.getSearchInput();
      expect(input).toBeInstanceOf(Input);
    });
  });

  // -----------------------------------------------------------------------
  // Gap 3: Search Input IME cursor
  // -----------------------------------------------------------------------

  describe("search input IME cursor", () => {
    it("renders Input at exact available width after 'Search: ' prefix", () => {
      const selector = makeSelector({
        all: [makeModel("anthropic", "claude-sonnet")],
      });
      // The input line should be "Search: " + rendered input
      const lines = selector.render(80);
      const searchLine = lines.find((l) => l.includes("Search:"));
      expect(searchLine).toBeDefined();
      // The visible width should be <= 80
      if (searchLine) {
        expect(visibleWidth(searchLine)).toBeLessThanOrEqual(80);
      }
    });

    it("renders prompt truncated when available width <= 0", () => {
      const selector = makeSelector({
        all: [makeModel("anthropic", "claude-sonnet")],
      });
      // At width 0, the search prompt should be truncated to empty
      const lines = selector.render(0);
      const searchLine = lines.find((l) => l.includes("Search"));
      // At width 0, "Search: " truncated to width 0 = ""
      // The line should exist but have visibleWidth <= 0
      if (searchLine) {
        expect(visibleWidth(searchLine)).toBeLessThanOrEqual(0);
      }
    });

    it("focused Input includes CURSOR_MARKER in rendered output", () => {
      const selector = makeSelector({
        all: [makeModel("anthropic", "claude-sonnet")],
      });
      // Set a value so the input renders something
      selector.getSearchInput().setValue("test");
      // Focus the selector
      selector.focused = true;
      const lines = selector.render(80);
      // Check that CURSOR_MARKER appears somewhere in the rendered output
      const hasCursorMarker = lines.some((l) => l.includes(CURSOR_MARKER));
      // The marker may or may not appear depending on implementation; verify it's safe
      expect(hasCursorMarker).toBe(true);
    });

    it("CURSOR_MARKER line width is within bounds", () => {
      const selector = makeSelector({
        all: [makeModel("anthropic", "claude-sonnet")],
      });
      selector.getSearchInput().setValue("test");
      selector.focused = true;
      const lines = selector.render(80);
      for (const line of lines) {
        // CURSOR_MARKER is zero-width, so visibleWidth should still be <= 80
        expect(visibleWidth(line)).toBeLessThanOrEqual(80);
      }
    });

    // -------------------------------------------------------------------
    // Focused long-query tests for every width 0-14: every line <= width
    // and CURSOR_MARKER present on the search line.
    // -------------------------------------------------------------------

    it("focused long-query at every width 0-14: all lines width-safe and CURSOR_MARKER on search line", () => {
      const selector = makeSelector({
        all: [makeModel("anthropic", "claude-sonnet")],
      });
      selector.getSearchInput().setValue("testlongquery");
      selector.focused = true;
      for (const width of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) {
        const lines = selector.render(width);
        expect(lines.length).toBeGreaterThan(0);
        for (const line of lines) {
          expect(visibleWidth(line)).toBeLessThanOrEqual(width);
        }
        const searchLine = lines[1];
        expect(searchLine).toBeDefined();
        expect(searchLine).toContain(CURSOR_MARKER);
      }
    });

    it("focused long-query at width 9-10 omits Search prompt (too narrow for Input's internal > prompt + cursor)", () => {
      const selector = makeSelector({
        all: [makeModel("anthropic", "claude-sonnet")],
      });
      selector.getSearchInput().setValue("testlongquery");
      selector.focused = true;
      for (const width of [9, 10]) {
        const lines = selector.render(width);
        const searchLine = lines[1];
        expect(searchLine).toBeDefined();
        // "Search: " (8) + Input internal prompt (> , 2) = 10, but Input needs
        // at least 3 cells for prompt+cursor+content, so total would be 11.
        // At widths 9-10, the outer prompt must be omitted, leaving Input
        // rendered at full width.
        expect(searchLine).not.toContain("Search:");
        expect(searchLine).toContain(CURSOR_MARKER);
        expect(visibleWidth(searchLine)).toBeLessThanOrEqual(width);
      }
    });

    it("focused long-query at width 11+ includes Search prompt with cursor", () => {
      const selector = makeSelector({
        all: [makeModel("anthropic", "claude-sonnet")],
      });
      selector.getSearchInput().setValue("testlongquery");
      selector.focused = true;
      for (const width of [11, 12, 13, 14]) {
        const lines = selector.render(width);
        const searchLine = lines[1];
        expect(searchLine).toBeDefined();
        expect(searchLine).toContain("Search:");
        expect(searchLine).toContain(CURSOR_MARKER);
        expect(visibleWidth(searchLine)).toBeLessThanOrEqual(width);
      }
    });

    it("focused at width 0 returns CURSOR_MARKER (width-0 marker)", () => {
      const selector = makeSelector({
        all: [makeModel("anthropic", "claude-sonnet")],
      });
      selector.getSearchInput().setValue("testlongquery");
      selector.focused = true;
      const lines = selector.render(0);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(0);
      }
      const searchLine = lines[1];
      expect(searchLine).toBeDefined();
      expect(visibleWidth(searchLine)).toBe(0);
      // Input.render(0) returns only "> " without cursor marker;
      // we must explicitly preserve CURSOR_MARKER when focused.
      expect(searchLine).toContain(CURSOR_MARKER);
    });

    it("unfocused at every width 0-14 still renders width-safe", () => {
      const selector = makeSelector({
        all: [makeModel("anthropic", "claude-sonnet")],
      });
      selector.getSearchInput().setValue("testlongquery");
      selector.focused = false;
      for (const width of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) {
        const lines = selector.render(width);
        expect(lines.length).toBeGreaterThan(0);
        for (const line of lines) {
          expect(visibleWidth(line)).toBeLessThanOrEqual(width);
        }
      }
    });
  });

  // -----------------------------------------------------------------------
  // invalidate
  // -----------------------------------------------------------------------

  describe("invalidate", () => {
    it("calls invalidate on the embedded Input", () => {
      const selector = makeSelector({
        all: [makeModel("anthropic", "claude-sonnet")],
      });
      const input = selector.getSearchInput();
      const spy = vi.spyOn(input, "invalidate");

      selector.invalidate();
      expect(spy).toHaveBeenCalled();
    });

    it("theme colors are rebuilt after invalidate", () => {
      const selector = makeSelector({
        all: [makeModel("anthropic", "claude-sonnet")],
      });

      const before = selector.render(80);
      selector.invalidate();
      const after = selector.render(80);

      // Renders should be equivalent after invalidate
      expect(after).toEqual(before);
    });

    // -------------------------------------------------------------------
    // Gap 4: Theme invalidation meaningful
    // -------------------------------------------------------------------

    it("theme change is reflected after invalidate with mutated theme functions", () => {
      const theme = makeTheme();
      const selector = makeSelector({
        all: [makeModel("anthropic", "claude-sonnet")],
        theme,
      });

      const before = selector.render(80);
      // Mutate the theme: replace a function with a different one
      const originalTitle = theme.title;
      theme.title = (text: string) => `\x1b[4m${text}\x1b[24m`; // underline instead of bold
      selector.invalidate();
      const after = selector.render(80);

      // The title line should differ because the theme function changed
      const titleBefore = before.find((l) => l.includes("Configure agent model"));
      const titleAfter = after.find((l) => l.includes("Configure agent model"));
      expect(titleBefore).toBeDefined();
      expect(titleAfter).toBeDefined();
      expect(titleBefore).not.toBe(titleAfter);

      // Restore
      theme.title = originalTitle;
    });

    it("no stale cached colors after fresh render", () => {
      const theme = makeTheme();
      const selector = makeSelector({
        all: [makeModel("anthropic", "claude-sonnet")],
        theme,
        current: "anthropic/claude-sonnet",
      });

      // Render twice; output should be stable (no caching issues)
      const lines1 = selector.render(80);
      // Move selection and render again
      selector.handleInput("\x1b[A"); // up
      const lines2 = selector.render(80);
      // Move back and render again
      selector.handleInput("\x1b[B"); // down
      const lines3 = selector.render(80);

      // lines1 and lines3 should be equivalent (same state)
      expect(lines3).toEqual(lines1);
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe("edge cases", () => {
    it("does not select when no items are available (empty model list)", () => {
      const onSelect = vi.fn();
      const selector = makeSelector({ onSelect });

      // Should still render pinned actions
      const lines = selector.render(80);
      expect(lines.length).toBeGreaterThan(0);

      // Enter should still work for pinned actions
      selector.handleInput("\r");
      expect(onSelect).toHaveBeenCalledWith({ kind: "inherit" });
    });

    it("filters live as input changes", () => {
      const selector = makeSelector({
        all: [
          makeModel("openai", "gpt-5"),
          makeModel("anthropic", "claude-sonnet"),
        ],
      });

      // Type "gpt"
      selector.handleInput("g");
      selector.handleInput("p");
      selector.handleInput("t");

      const lines = selector.render(80);
      const hasGpt = lines.some((l) => l.includes("gpt-5"));
      const hasClaude = lines.some((l) => l.includes("claude-sonnet"));
      expect(hasGpt).toBe(true);
      expect(hasClaude).toBe(false);
    });

    it("pinned actions remain visible even when model filter matches nothing", () => {
      const selector = makeSelector({
        all: [makeModel("anthropic", "claude-sonnet")],
      });

      // Type something that doesn't match
      selector.handleInput("z");
      selector.handleInput("z");
      selector.handleInput("z");
      selector.handleInput("z");
      selector.handleInput("z");

      const lines = selector.render(80);
      const hasInherit = lines.some((l) => l.includes("Inherit"));
      const hasManual = lines.some((l) => l.includes("Enter model manually"));
      expect(hasInherit).toBe(true);
      expect(hasManual).toBe(true);
    });

    it("resets filter when clearing input via backspace", () => {
      const selector = makeSelector({
        all: [
          makeModel("openai", "gpt-5"),
          makeModel("anthropic", "claude-sonnet"),
        ],
      });

      // Type and then clear
      selector.handleInput("g");
      selector.handleInput("p");
      selector.handleInput("t");

      // Clear via backspace
      selector.handleInput("\x7f"); // DEL
      selector.handleInput("\x7f");
      selector.handleInput("\x7f");

      const lines = selector.render(80);
      const hasGpt = lines.some((l) => l.includes("gpt-5"));
      const hasClaude = lines.some((l) => l.includes("claude-sonnet"));
      expect(hasGpt).toBe(true);
      expect(hasClaude).toBe(true);
    });

    it("initial current selection is visible in viewport", () => {
      const selector = makeSelector({
        all: makeModels(30),
        current: "provider/model-15",
      });

      const lines = selector.render(80);
      const hasCurrent = lines.some((l) => l.includes("model-15"));
      expect(hasCurrent).toBe(true);
    });

    it("arrow up/down are not delegated to the embedded Input", () => {
      const selector = makeSelector({
        all: [makeModel("anthropic", "claude-sonnet")],
      });
      const input = selector.getSearchInput();
      const beforeValue = input.getValue();

      selector.handleInput("\x1b[A"); // up
      expect(input.getValue()).toBe(beforeValue);

      selector.handleInput("\x1b[B"); // down
      expect(input.getValue()).toBe(beforeValue);
    });

    it("wide width (120) renders correctly", () => {
      const selector = makeSelector({
        all: [
          makeModel("anthropic", "claude-sonnet"),
          makeModel("openai", "gpt-5"),
        ],
      });
      const lines = selector.render(120);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(120);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// showSearchableModelSelector tests
// ---------------------------------------------------------------------------

/** Build a structurally minimal Theme for testing the adapter. */
function makeFakeTheme(): Theme {
  return new Theme(
    {
      accent: "#00ffff",
      border: "#ffffff",
      borderAccent: "#00ffff",
      borderMuted: "#888888",
      success: "#00ff00",
      error: "#ff0000",
      warning: "#ffff00",
      muted: "#888888",
      dim: "#888888",
      text: "#ffffff",
      thinkingText: "#ffffff",
      userMessageText: "#ffffff",
      customMessageText: "#ffffff",
      customMessageLabel: "#ffffff",
      toolTitle: "#ffffff",
      toolOutput: "#ffffff",
      mdHeading: "#ffffff",
      mdLink: "#00ffff",
      mdLinkUrl: "#888888",
      mdCode: "#ffffff",
      mdCodeBlock: "#ffffff",
      mdCodeBlockBorder: "#888888",
      mdQuote: "#888888",
      mdQuoteBorder: "#888888",
      mdHr: "#888888",
      mdListBullet: "#ffffff",
      toolDiffAdded: "#00ff00",
      toolDiffRemoved: "#ff0000",
      toolDiffContext: "#888888",
      syntaxComment: "#888888",
      syntaxKeyword: "#00ffff",
      syntaxFunction: "#ffffff",
      syntaxVariable: "#ffffff",
      syntaxString: "#00ff00",
      syntaxNumber: "#ffff00",
      syntaxType: "#00ffff",
      syntaxOperator: "#ffffff",
      syntaxPunctuation: "#ffffff",
      thinkingOff: "#888888",
      thinkingMinimal: "#888888",
      thinkingLow: "#888888",
      thinkingMedium: "#888888",
      thinkingHigh: "#888888",
      thinkingXhigh: "#888888",
      thinkingMax: "#888888",
      bashMode: "#ffffff",
    },
    {
      selectedBg: "#000000",
      userMessageBg: "#000000",
      customMessageBg: "#000000",
      toolPendingBg: "#000000",
      toolSuccessBg: "#000000",
      toolErrorBg: "#000000",
    },
    "truecolor",
  );
}

/** Build a structurally minimal fake TUI for the custom callback. */
function makeFakeTUI(overrides: Partial<TUI> = {}): TUI {
  return {
    requestRender: vi.fn(),
    ...overrides,
  } as unknown as TUI;
}

/** Build a fake ExtensionCommandContext with mode, hasUI and ui.custom. */
function makeFakeContext(
  overrides: {
    mode?: "tui" | "rpc" | "json" | "print";
    hasUI?: boolean;
    customImpl?: (factory: (tui: TUI, theme: Theme, keybindings: KeybindingsManager, done: (result: ModelSelection | undefined) => void) => Component) => Promise<ModelSelection | undefined>;
    notify?: (msg: string, level: string) => void;
  } = {},
): ExtensionCommandContext {
  const {
    mode = "tui",
    hasUI = true,
    customImpl = async () => undefined,
    notify = () => {},
  } = overrides;

  return {
    mode,
    hasUI,
    ui: {
      custom: customImpl,
      notify,
    },
  } as unknown as ExtensionCommandContext;
}

describe("showSearchableModelSelector", () => {
  // Reset keybindings before each test
  beforeEach(() => {
    setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS));
  });

  // -----------------------------------------------------------------------
  // 1. Unit: fake ctx.ui.custom, inspect component, simulate Enter/Escape
  // -----------------------------------------------------------------------

  it("invokes ctx.ui.custom exactly once and returns a SearchableModelSelector", async () => {
    let capturedComponent: Component | undefined;

    const ctx = makeFakeContext({
      customImpl: async (factory) => {
        const tui = makeFakeTUI();
        const theme = makeFakeTheme();
        const kb = new KeybindingsManager(TUI_KEYBINDINGS);
        const comp = factory(tui, theme, kb, () => {});
        capturedComponent = comp;
        return undefined;
      },
    });

    await showSearchableModelSelector(ctx, {
      enabled: [makeModel("anthropic", "claude-sonnet")],
      all: [makeModel("anthropic", "claude-sonnet")],
    });

    expect(capturedComponent).toBeDefined();
    expect(capturedComponent).toBeInstanceOf(SearchableModelSelector);
  });

  it("Enter on Inherit returns { kind: 'inherit' }", async () => {
    let result: ModelSelection | undefined;

    const ctx = makeFakeContext({
      customImpl: async (factory) => {
        return new Promise<ModelSelection | undefined>((resolve) => {
          const tui = makeFakeTUI();
          const theme = makeFakeTheme();
          const kb = new KeybindingsManager(TUI_KEYBINDINGS);
          const comp = factory(
            tui,
            theme,
            kb,
            (selection) => resolve(selection),
          );
          // Default selection is Inherit (index 0)
          assertHasHandleInput(comp);
          comp.handleInput("\r"); // Enter
        });
      },
    });

    result = await showSearchableModelSelector(ctx, {
      enabled: [makeModel("anthropic", "claude-sonnet")],
      all: [makeModel("anthropic", "claude-sonnet")],
    });

    expect(result).toEqual({ kind: "inherit" });
  });

  it("Enter on a model returns { kind: 'model', value: 'provider/id' }", async () => {
    let result: ModelSelection | undefined;

    const ctx = makeFakeContext({
      customImpl: async (factory) => {
        return new Promise<ModelSelection | undefined>((resolve) => {
          const tui = makeFakeTUI();
          const theme = makeFakeTheme();
          const kb = new KeybindingsManager(TUI_KEYBINDINGS);
          const comp = factory(
            tui,
            theme,
            kb,
            (selection) => resolve(selection),
          );
          // Move down twice: Inherit -> Manual -> first model
          assertHasHandleInput(comp);
          comp.handleInput("\x1b[B"); // down
          comp.handleInput("\x1b[B"); // down
          comp.handleInput("\r"); // Enter
        });
      },
    });

    result = await showSearchableModelSelector(ctx, {
      enabled: [makeModel("anthropic", "claude-sonnet")],
      all: [makeModel("anthropic", "claude-sonnet")],
    });

    expect(result).toEqual({ kind: "model", value: "anthropic/claude-sonnet" });
  });

  it("Escape returns undefined", async () => {
    let result: ModelSelection | undefined;

    const ctx = makeFakeContext({
      customImpl: async (factory) => {
        return new Promise<ModelSelection | undefined>((resolve) => {
          const tui = makeFakeTUI();
          const theme = makeFakeTheme();
          const kb = new KeybindingsManager(TUI_KEYBINDINGS);
          const comp = factory(
            tui,
            theme,
            kb,
            (selection) => resolve(selection),
          );
          assertHasHandleInput(comp);
          comp.handleInput("\x1b"); // Escape
        });
      },
    });

    result = await showSearchableModelSelector(ctx, {
      enabled: [makeModel("anthropic", "claude-sonnet")],
      all: [makeModel("anthropic", "claude-sonnet")],
    });

    expect(result).toBeUndefined();
  });

  it("navigates to current model when options.current is set", async () => {
    let selectedLine: string | undefined;

    const ctx = makeFakeContext({
      customImpl: async (factory) => {
        return new Promise<ModelSelection | undefined>((resolve) => {
          const tui = makeFakeTUI();
          const theme = makeFakeTheme();
          const kb = new KeybindingsManager(TUI_KEYBINDINGS);
          const comp = factory(
            tui,
            theme,
            kb,
            (selection) => resolve(selection),
          );
          // The current model should be pre-selected
          // Arrow prefix for selected item is "→ ", and model-2 should be on the line
          const lines = comp.render(80);
          const selected = lines.find((l: string) => l.includes("→") && l.includes("model-2"));
          selectedLine = selected;
          resolve(undefined);
        });
      },
    });

    await showSearchableModelSelector(ctx, {
      enabled: [makeModel("provider", "model-2")],
      all: [
        makeModel("provider", "model-1"),
        makeModel("provider", "model-2"),
        makeModel("provider", "model-3"),
      ],
      current: "provider/model-2",
    });

    expect(selectedLine).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // 2. Fresh instances across calls
  // -----------------------------------------------------------------------

  it("constructs a fresh component on each invocation", async () => {
    const components: Component[] = [];

    const ctx = makeFakeContext({
      customImpl: async (factory) => {
        const tui = makeFakeTUI();
        const theme = makeFakeTheme();
        const kb = new KeybindingsManager(TUI_KEYBINDINGS);
        const comp = factory(tui, theme, kb, () => {});
        components.push(comp);
        return undefined;
      },
    });

    await showSearchableModelSelector(ctx, {
      enabled: [makeModel("anthropic", "claude-sonnet")],
      all: [makeModel("anthropic", "claude-sonnet")],
    });

    await showSearchableModelSelector(ctx, {
      enabled: [makeModel("openai", "gpt-5")],
      all: [makeModel("openai", "gpt-5"), makeModel("anthropic", "claude-sonnet")],
    });

    expect(components).toHaveLength(2);
    // Different instances
    expect(components[0]).not.toBe(components[1]);
  });

  it("second call reflects new options.current initial selection", async () => {
    let secondSelectedLine: string | undefined;

    const ctx = makeFakeContext({
      customImpl: async (factory) => {
        const tui = makeFakeTUI();
        const theme = makeFakeTheme();
        const kb = new KeybindingsManager(TUI_KEYBINDINGS);
        const comp = factory(tui, theme, kb, () => {});
        const lines = comp.render(80);
        const selected = lines.find((l: string) => l.includes("→") && l.includes("model-b"));
        secondSelectedLine = selected;
        return undefined;
      },
    });

    // Second call with different current
    await showSearchableModelSelector(ctx, {
      enabled: [makeModel("p", "model-b")],
      all: [
        makeModel("p", "model-a"),
        makeModel("p", "model-b"),
      ],
      current: "p/model-b",
    });

    expect(secondSelectedLine).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // 3. No UI -> notify error, return undefined, no custom call
  // -----------------------------------------------------------------------

  it("notifies error and returns undefined when hasUI is false", async () => {
    const notifyCalls: Array<{ msg: string; level: string }> = [];
    let customCalled = false;

    const ctx = makeFakeContext({
      hasUI: false,
      notify: (msg, level) => {
        notifyCalls.push({ msg, level });
      },
      customImpl: async () => {
        customCalled = true;
        return undefined;
      },
    });

    const result = await showSearchableModelSelector(ctx, {
      enabled: [makeModel("anthropic", "claude-sonnet")],
      all: [makeModel("anthropic", "claude-sonnet")],
    });

    expect(result).toBeUndefined();
    expect(customCalled).toBe(false);
    expect(notifyCalls.length).toBeGreaterThan(0);
    expect(notifyCalls[0].level).toBe("error");
    expect(notifyCalls[0].msg).toMatch(/interactive TUI/i);
  });

  it("notifies error and returns undefined when mode is rpc with hasUI true", async () => {
    const notifyCalls: Array<{ msg: string; level: string }> = [];
    let customCallCount = 0;

    const ctx = makeFakeContext({
      mode: "rpc",
      hasUI: true,
      notify: (msg, level) => {
        notifyCalls.push({ msg, level });
      },
      customImpl: async () => {
        customCallCount++;
        return undefined;
      },
    });

    const result = await showSearchableModelSelector(ctx, {
      enabled: [makeModel("anthropic", "claude-sonnet")],
      all: [makeModel("anthropic", "claude-sonnet")],
    });

    expect(result).toBeUndefined();
    expect(customCallCount).toBe(0);
    expect(notifyCalls).toHaveLength(1);
    expect(notifyCalls[0].level).toBe("error");
    expect(notifyCalls[0].msg).toMatch(/interactive TUI/i);
  });

  it("notifies error and returns undefined when mode is print with hasUI true", async () => {
    const notifyCalls: Array<{ msg: string; level: string }> = [];
    let customCallCount = 0;

    const ctx = makeFakeContext({
      mode: "print",
      hasUI: true,
      notify: (msg, level) => {
        notifyCalls.push({ msg, level });
      },
      customImpl: async () => {
        customCallCount++;
        return undefined;
      },
    });

    const result = await showSearchableModelSelector(ctx, {
      enabled: [makeModel("anthropic", "claude-sonnet")],
      all: [makeModel("anthropic", "claude-sonnet")],
    });

    expect(result).toBeUndefined();
    expect(customCallCount).toBe(0);
    expect(notifyCalls).toHaveLength(1);
    expect(notifyCalls[0].level).toBe("error");
    expect(notifyCalls[0].msg).toMatch(/interactive TUI/i);
  });

  it("notifies error and returns undefined when mode is json with hasUI true", async () => {
    const notifyCalls: Array<{ msg: string; level: string }> = [];
    let customCallCount = 0;

    const ctx = makeFakeContext({
      mode: "json",
      hasUI: true,
      notify: (msg, level) => {
        notifyCalls.push({ msg, level });
      },
      customImpl: async () => {
        customCallCount++;
        return undefined;
      },
    });

    const result = await showSearchableModelSelector(ctx, {
      enabled: [makeModel("anthropic", "claude-sonnet")],
      all: [makeModel("anthropic", "claude-sonnet")],
    });

    expect(result).toBeUndefined();
    expect(customCallCount).toBe(0);
    expect(notifyCalls).toHaveLength(1);
    expect(notifyCalls[0].level).toBe("error");
    expect(notifyCalls[0].msg).toMatch(/interactive TUI/i);
  });

  // -----------------------------------------------------------------------
  // 4. requestRender is forwarded to tui.requestRender
  // -----------------------------------------------------------------------

  it("forwards requestRender to tui.requestRender", async () => {
    let capturedTUI: TUI | undefined;

    const ctx = makeFakeContext({
      customImpl: async (factory) => {
        const tui = makeFakeTUI();
        capturedTUI = tui;
        const theme = makeFakeTheme();
        const kb = new KeybindingsManager(TUI_KEYBINDINGS);
        const comp = factory(tui, theme, kb, () => {});
        // Trigger input which calls requestRender
        assertHasHandleInput(comp);
        comp.handleInput("\x1b[B"); // down
        return undefined;
      },
    });

    await showSearchableModelSelector(ctx, {
      enabled: [makeModel("anthropic", "claude-sonnet")],
      all: [makeModel("anthropic", "claude-sonnet")],
    });

    expect(capturedTUI).toBeDefined();
    expect(capturedTUI!.requestRender).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 5. Theme adapter builds correct theme
  // -----------------------------------------------------------------------

  it("buildSelectorTheme maps theme functions correctly", () => {
    const theme = makeFakeTheme();
    const st = buildSelectorTheme(theme);

    expect(typeof st.title).toBe("function");
    expect(typeof st.selectedPrefix).toBe("function");
    expect(typeof st.selectedText).toBe("function");
    expect(typeof st.description).toBe("function");
    expect(typeof st.scrollInfo).toBe("function");
    expect(typeof st.noMatch).toBe("function");
    expect(typeof st.hint).toBe("function");
    expect(typeof st.enabledMarker).toBe("function");
    expect(typeof st.provider).toBe("function");

    // Verify output contains the input text (chalk may or may not add ANSI
    // codes depending on TTY detection, but the input text should survive)
    const titleResult = st.title("Hello");
    expect(titleResult).toContain("Hello");

    const accentResult = st.selectedText("Hello");
    expect(accentResult).toContain("Hello");

    // title applies fg("accent", bold(text)) — nested bold inside accent
    const boldSpy = vi.spyOn(theme, "bold").mockImplementation((t: string) => `[bold]${t}[/bold]`);
    const fgSpy = vi.spyOn(theme, "fg").mockImplementation((_c: string, t: string) => `[accent]${t}[/accent]`);
    try {
      const result = st.title("Hello");
      expect(boldSpy).toHaveBeenCalledWith("Hello");
      expect(fgSpy).toHaveBeenCalledWith("accent", "[bold]Hello[/bold]");
      expect(result).toBe("[accent][bold]Hello[/bold][/accent]");
    } finally {
      boldSpy.mockRestore();
      fgSpy.mockRestore();
    }
  });
});