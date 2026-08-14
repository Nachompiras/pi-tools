/**
 * UI adapter: bridges ExtensionCommandContext to SearchableModelSelector.
 *
 * Provides `showSearchableModelSelector` which replaces the flat generic
 * `ctx.ui.select` model picker with a proper searchable, filterable component
 * rendered via `ctx.ui.custom`.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { KeybindingsManager, TUI } from "@earendil-works/pi-tui";
import { SearchableModelSelector } from "./model-selector.js";
import type { SearchableModelSelectorTheme } from "./model-selector.js";
import type { ModelSelection, ModelSelectorOptions } from "./types.js";

// ---------------------------------------------------------------------------
// Theme adapter
// ---------------------------------------------------------------------------

/**
 * Build a SearchableModelSelectorTheme from the callback TUI theme.
 *
 * Maps semantic roles to Theme colors:
 * - title: accent bold
 * - selectedPrefix / selectedText: accent
 * - description: muted
 * - scrollInfo: dim
 * - noMatch: warning
 * - hint: dim
 * - enabledMarker: success
 * - provider: muted
 */
export function buildSelectorTheme(theme: Theme): SearchableModelSelectorTheme {
  return {
    title: (text: string) => theme.fg("accent", theme.bold(text)),
    selectedPrefix: (text: string) => theme.fg("accent", text),
    selectedText: (text: string) => theme.fg("accent", text),
    description: (text: string) => theme.fg("muted", text),
    scrollInfo: (text: string) => theme.fg("dim", text),
    noMatch: (text: string) => theme.fg("warning", text),
    hint: (text: string) => theme.fg("dim", text),
    enabledMarker: (text: string) => theme.fg("success", text),
    provider: (text: string) => theme.fg("muted", text),
  };
}

// ---------------------------------------------------------------------------
// showSearchableModelSelector
// ---------------------------------------------------------------------------

/**
 * Show a searchable model selector using `ctx.ui.custom`.
 *
 * When `ctx.hasUI` is false (print or json mode), a notification is emitted
 * and `undefined` is returned immediately.
 *
 * Otherwise, the component is constructed fresh each invocation via the
 * `ctx.ui.custom` factory callback. The user's selection is returned via
 * the `done` callback; cancellation (Escape) returns `undefined`.
 */
export async function showSearchableModelSelector(
  ctx: ExtensionCommandContext,
  options: ModelSelectorOptions,
): Promise<ModelSelection | undefined> {
  if (ctx.mode !== "tui" || !ctx.hasUI) {
    ctx.ui.notify(
      "Searchable model selector is only available in interactive TUI mode",
      "error",
    );
    return undefined;
  }

  return ctx.ui.custom<ModelSelection | undefined>(
    (tui: TUI, theme: Theme, keybindings: KeybindingsManager, done: (result: ModelSelection | undefined) => void) => {
      const selectorTheme = buildSelectorTheme(theme);

      return new SearchableModelSelector(
        {
          enabled: options.enabled,
          all: options.all,
          current: options.current,
          onSelect: (selection) => done(selection),
          onCancel: () => done(undefined),
          requestRender: () => tui.requestRender(),
        },
        selectorTheme,
        keybindings,
      );
    },
  );
}