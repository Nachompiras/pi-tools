import { CURSOR_MARKER, Input, KeybindingsManager, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Component, Focusable } from "@earendil-works/pi-tui";
import type { ModelDescriptor, ModelSelection, ModelSelectorOptions } from "./types.js";
import { ModelSelectorState } from "./model-selector-state.js";

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

export interface SearchableModelSelectorTheme {
  title: (text: string) => string;
  selectedPrefix: (text: string) => string;
  selectedText: (text: string) => string;
  description: (text: string) => string;
  scrollInfo: (text: string) => string;
  noMatch: (text: string) => string;
  hint: (text: string) => string;
  enabledMarker: (text: string) => string;
  provider: (text: string) => string;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface SearchableModelSelectorOptions extends ModelSelectorOptions {
  onSelect(selection: ModelSelection): void;
  onCancel(): void;
  requestRender(): void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_VIEWPORT = 10;
const PINNED_ACTIONS_COUNT = 2; // inherit + manual

// ---------------------------------------------------------------------------
// SearchableModelSelector
// ---------------------------------------------------------------------------

export class SearchableModelSelector implements Component, Focusable {
  private state: ModelSelectorState;
  private searchInput: Input;
  private theme: SearchableModelSelectorTheme;
  private keybindings: KeybindingsManager;
  private onSelect: (selection: ModelSelection) => void;
  private onCancel: () => void;
  private requestRender: () => void;
  private viewportSize: number = DEFAULT_VIEWPORT;
  private scrollOffset: number = 0;
  private _focused: boolean = false;

  constructor(
    options: SearchableModelSelectorOptions,
    theme: SearchableModelSelectorTheme,
    keybindings: KeybindingsManager,
  ) {
    this.state = new ModelSelectorState({
      enabled: options.enabled,
      all: options.all,
      current: options.current,
    });
    this.theme = theme;
    this.keybindings = keybindings;
    this.onSelect = options.onSelect;
    this.onCancel = options.onCancel;
    this.requestRender = options.requestRender;

    this.searchInput = new Input();
    this.searchInput.focused = false;
  }

  // -----------------------------------------------------------------------
  // Focusable
  // -----------------------------------------------------------------------

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.searchInput.focused = value;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  getSearchInput(): Input {
    return this.searchInput;
  }

  invalidate(): void {
    this.searchInput.invalidate();
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  render(width: number): string[] {
    const w = Math.max(0, width);
    const lines: string[] = [];

    // Title
    lines.push(this.renderTitle(w));

    // Search input
    lines.push(this.renderSearchInput(w));

    // Separator
    lines.push("");

    // Items
    const items = this.state.items;
    const selectedIndex = this.state.selectedIndex;

    // Split items into pinned actions and model items
    const pinnedItems = items.filter((i) => i.kind === "inherit" || i.kind === "manual");
    const modelItems = items.filter((i) => i.kind === "model");
    const hasNoModels = modelItems.length === 0 && this.state.query !== "";

    if (items.length === 0) {
      lines.push(this.theme.noMatch(truncateToWidth("  No matching models", w, "")));
    } else {
      // Always render pinned actions (they are always visible)
      // Pinned action indices: 0 and 1 in the full list
      const pinnedSelected = selectedIndex < PINNED_ACTIONS_COUNT;
      for (let i = 0; i < pinnedItems.length; i++) {
        const item = pinnedItems[i];
        if (!item) continue;
        // The pinned item's index in the full list is i
        const isSelected = i === selectedIndex;
        lines.push(this.renderItem(item, isSelected, w));
      }

      // Model viewport: scrollable window of model items around the selected model
      if (modelItems.length > 0) {
        // Translate selectedIndex to model-only index
        const modelSelectedIndex = selectedIndex - PINNED_ACTIONS_COUNT;
        const clampedModelSelected = Math.max(0, Math.min(modelSelectedIndex, modelItems.length - 1));

        // Ensure selected model is visible in viewport
        this.ensureModelVisible(modelItems.length, clampedModelSelected);

        const start = this.scrollOffset;
        const end = Math.min(start + this.viewportSize, modelItems.length);

        for (let i = start; i < end; i++) {
          const item = modelItems[i];
          if (!item) continue;
          // The model item's full index is i + PINNED_ACTIONS_COUNT
          const isSelected = pinnedSelected ? false : (i + PINNED_ACTIONS_COUNT === selectedIndex);
          lines.push(this.renderItem(item, isSelected, w));
        }

        // Scroll indicator for model items
        if (modelItems.length > this.viewportSize) {
          const scrollModelIdx = pinnedSelected ? 0 : clampedModelSelected;
          const scrollText = `  (${scrollModelIdx + 1}/${modelItems.length})`;
          lines.push(this.theme.scrollInfo(truncateToWidth(scrollText, w, "")));
        }
      }

      // No-results message for models
      if (hasNoModels) {
        lines.push(this.theme.noMatch(truncateToWidth("  No matching models", w, "")));
      }
    }

    // Footer (hints)
    lines.push("");
    lines.push(this.renderFooter(w));

    return lines;
  }

  // -----------------------------------------------------------------------
  // Handle Input
  // -----------------------------------------------------------------------

  handleInput(data: string): void {
    const kb = this.keybindings;

    // Escape / Cancel
    if (kb.matches(data, "tui.select.cancel")) {
      this.onCancel();
      this.requestRender();
      return;
    }

    // Navigation: up
    if (kb.matches(data, "tui.select.up")) {
      this.state.move(-1);
      this.requestRender();
      return;
    }

    // Navigation: down
    if (kb.matches(data, "tui.select.down")) {
      this.state.move(1);
      this.requestRender();
      return;
    }

    // Confirm / Enter
    if (kb.matches(data, "tui.select.confirm")) {
      const selection = this.state.selection();
      if (selection) {
        this.onSelect(selection);
      }
      this.requestRender();
      return;
    }

    // Delegate to search input: printable characters and editing
    // Check if data is printable (not a control sequence)
    if (this.isPrintableOrBackspace(data)) {
      this.searchInput.handleInput(data);
      // After input processes, sync query from input value
      const value = this.searchInput.getValue();
      this.state.setQuery(value);
      this.scrollOffset = 0;
      this.requestRender();
      return;
    }

    // For other keys (like cursor movement within input), delegate to input
    // but don't sync query (cursor movement doesn't change value)
    const beforeValue = this.searchInput.getValue();
    this.searchInput.handleInput(data);
    const afterValue = this.searchInput.getValue();
    if (beforeValue !== afterValue) {
      this.state.setQuery(afterValue);
      this.scrollOffset = 0;
    }
    this.requestRender();
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private isPrintableOrBackspace(data: string): boolean {
    // Check for backspace
    const kb = this.keybindings;
    if (kb.matches(data, "tui.editor.deleteCharBackward")) return true;

    // Check for printable characters (not control sequences)
    const hasControlChars = [...data].some((ch) => {
      const code = ch.charCodeAt(0);
      return code < 32 || code === 0x7f || (code >= 0x80 && code <= 0x9f);
    });
    return !hasControlChars && data.length > 0;
  }

  private ensureModelVisible(totalModelItems: number, modelSelectedIndex: number): void {
    // If selected model is above viewport, scroll up
    if (modelSelectedIndex < this.scrollOffset) {
      this.scrollOffset = modelSelectedIndex;
    }
    // If selected model is below viewport, scroll down
    if (modelSelectedIndex >= this.scrollOffset + this.viewportSize) {
      this.scrollOffset = modelSelectedIndex - this.viewportSize + 1;
    }
    // Clamp
    this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, Math.max(0, totalModelItems - this.viewportSize)));
  }

  private renderTitle(width: number): string {
    const title = "Configure agent model";
    return truncateToWidth(this.theme.title(title), width, "");
  }

  private renderSearchInput(width: number): string {
    const prompt = "Search: ";
    const promptWidth = visibleWidth(prompt);
    const available = width - promptWidth;

    // Input's internal prompt ("> ") has visible width 2 and needs at least
    // 3 cells (prompt + cursor + content). Only include the outer "Search: "
    // prompt when the remaining child width is sufficient for Input to render
    // its own prompt AND at least one cursor/content cell.
    const MIN_INPUT_WIDTH = 3;

    if (available < MIN_INPUT_WIDTH) {
      // Not enough room for outer prompt + Input's internal prompt + cursor.
      // Render Input directly at full width, preserving CURSOR_MARKER.
      const inputLines = this.searchInput.render(width);
      const inputLine = inputLines[0] ?? "";

      // If Input could only render its own prompt (no content area),
      // return CURSOR_MARKER when focused to preserve IME cursor
      // visibility, otherwise empty string.
      if (inputLine === "> " || inputLine === ">") {
        return this._focused ? CURSOR_MARKER : "";
      }

      return inputLine;
    }

    // Render the Input at the exact available width, then prepend prompt.
    // Input.render already ensures the result fits within the requested width
    // and includes CURSOR_MARKER when focused.
    const inputLines = this.searchInput.render(available);
    const inputLine = inputLines[0] ?? "";
    return prompt + inputLine;
  }

  private renderItem(
    item: Readonly<{ kind: string; key: string; model?: ModelDescriptor; enabled?: boolean }>,
    isSelected: boolean,
    width: number,
  ): string {
    const arrow = isSelected ? "→" : " ";
    const prefix = isSelected
      ? this.theme.selectedPrefix(arrow) + " "
      : "  ";
    const prefixWidth = visibleWidth(prefix);

    let line: string;

    switch (item.kind) {
      case "inherit": {
        const label = "Inherit (use default)";
        const truncated = truncateToWidth(label, Math.max(0, width - prefixWidth), "");
        if (isSelected) {
          line = this.theme.selectedText(`${prefix}${truncated}`);
        } else {
          line = prefix + truncated;
        }
        break;
      }
      case "manual": {
        const label = "Enter model manually...";
        const truncated = truncateToWidth(label, Math.max(0, width - prefixWidth), "");
        if (isSelected) {
          line = this.theme.selectedText(`${prefix}${truncated}`);
        } else {
          line = prefix + truncated;
        }
        break;
      }
      case "model": {
        const model = item.model!;
        const enabled = item.enabled ?? false;
        const enabledMark = enabled ? this.theme.enabledMarker("✓ ") : "  ";
        const enabledMarkWidth = visibleWidth(enabledMark);

        // Build: [enabled] model.id [provider]
        const providerStr = this.theme.provider(`[${model.provider}]`);
        const modelId = model.id;

        // Calculate available space
        const contentStart = prefixWidth + enabledMarkWidth;
        const available = Math.max(0, width - contentStart);

        // We need to fit: modelId + " " + providerStr
        // Try to fit both
        const providerVisible = visibleWidth(providerStr);
        const modelIdTruncated = truncateToWidth(modelId, Math.max(0, available - providerVisible - 1), "");
        const combined = `${modelIdTruncated} ${providerStr}`;
        const combinedTruncated = truncateToWidth(combined, available, "");

        if (isSelected) {
          line = this.theme.selectedText(`${prefix}${enabledMark}${combinedTruncated}`);
        } else {
          line = `${prefix}${enabledMark}${combinedTruncated}`;
        }
        break;
      }
      default:
        return "";
    }

    // Ensure the final line does not exceed width (critical for tiny widths)
    return truncateToWidth(line, width, "");
  }

  private renderFooter(width: number): string {
    const hint = "↑↓ navigate  ↵ select  esc cancel";
    return truncateToWidth(this.theme.hint(hint), width, "");
  }
}