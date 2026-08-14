import type {
  ModelDescriptor,
  ModelSelection,
  ModelSelectorItem,
  ModelSelectorOptions,
} from "./types.js";
import { modelFullId } from "./models.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Sort models deterministically by code-point order: provider, then id. */
function compareModels(a: ModelDescriptor, b: ModelDescriptor): number {
  if (a.provider < b.provider) return -1;
  if (a.provider > b.provider) return 1;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

function isValidDescriptor(d: ModelDescriptor): boolean {
  return (
    typeof d.provider === "string" &&
    d.provider.length > 0 &&
    typeof d.id === "string" &&
    d.id.length > 0
  );
}

/**
 * Normalize a string for search: Unicode NFKC normalization followed by
 * fixed-locale lowercasing (en-US). This ensures canonically equivalent
 * composed/decomposed forms match and avoids Turkish "i" ambiguity.
 */
function normalizeForSearch(s: string): string {
  return s.normalize("NFKC").toLocaleLowerCase("en-US");
}

/** Case-insensitive, Unicode-normalized check if a model matches the query. */
function modelMatchesQuery(model: ModelDescriptor, query: string): boolean {
  const needle = normalizeForSearch(query);
  const fullId = normalizeForSearch(modelFullId(model));
  return (
    normalizeForSearch(model.id).includes(needle) ||
    normalizeForSearch(model.provider).includes(needle) ||
    fullId.includes(needle) ||
    (model.name !== undefined && normalizeForSearch(model.name).includes(needle))
  );
}

/** Shallow-clone and freeze a ModelDescriptor so external mutations don't leak in. */
function cloneDescriptor(d: ModelDescriptor): Readonly<ModelDescriptor> {
  const copy: ModelDescriptor = { provider: d.provider, id: d.id };
  if (d.name !== undefined) copy.name = d.name;
  return Object.freeze(copy);
}

// ---------------------------------------------------------------------------
// ModelSelectorState
// ---------------------------------------------------------------------------

export class ModelSelectorState {
  private _query = "";

  /** All items (pinned + models) in display order, before filtering. Each item is frozen. */
  private readonly _allItems: readonly Readonly<ModelSelectorItem>[];

  /** Currently filtered items (subset of _allItems, pinned actions always included). Each item is frozen. */
  private _items: readonly Readonly<ModelSelectorItem>[];

  private _selectedIndex = 0;

  /** The current model's full ID (if set and found in the list), used for reset-on-clear. */
  private readonly _currentModelKey: string | undefined;

  /** Frozen pinned items reused across all item arrays. */
  private readonly _inheritItem: Readonly<ModelSelectorItem> = Object.freeze({ kind: "inherit", key: "inherit" } as const);
  private readonly _manualItem: Readonly<ModelSelectorItem> = Object.freeze({ kind: "manual", key: "manual" } as const);

  constructor(options: ModelSelectorOptions) {
    const { enabled, all } = options;

    // Build the set of enabled full IDs (first occurrence wins, preserving order)
    const enabledKeys: string[] = [];
    const enabledKeySet = new Set<string>();
    for (const d of enabled) {
      if (!isValidDescriptor(d)) continue;
      const key = modelFullId(d);
      if (!enabledKeySet.has(key)) {
        enabledKeySet.add(key);
        enabledKeys.push(key);
      }
    }

    // Build all models: deduplicate by full ID, first occurrence from `all` wins.
    // The selectable universe comes only from `all`.
    // Clone each descriptor so later input-object mutation does not alter
    // internal state (keys, search, render).
    const allModels = new Map<string, ModelDescriptor>();
    for (const d of all) {
      if (!isValidDescriptor(d)) continue;
      const key = modelFullId(d);
      if (!allModels.has(key)) {
        allModels.set(key, cloneDescriptor(d));
      }
    }

    // Build the model items: enabled first (in scoped order from `enabled`),
    // then remaining sorted deterministically.
    const enabledItems: ModelSelectorItem[] = [];
    const remainingItems: ModelSelectorItem[] = [];

    // First, enabled models in the order they appear in `enabled`,
    // but only if they actually exist in `all`.
    for (const key of enabledKeys) {
      const d = allModels.get(key);
      if (d) {
        enabledItems.push({
          kind: "model",
          key,
          model: d, // Use canonical all descriptor data
          enabled: true,
        });
      }
    }

    // Then remaining models (not enabled), sorted deterministically
    for (const [key, d] of allModels) {
      if (!enabledKeySet.has(key)) {
        remainingItems.push({
          kind: "model",
          key,
          model: d,
          enabled: false,
        });
      }
    }

    // Sort remaining items deterministically by provider, then id
    (remainingItems as Extract<ModelSelectorItem, { kind: "model" }>[]).sort(
      (a, b) => compareModels(a.model, b.model),
    );

    // Freeze each model item (model descriptor is already frozen from cloneDescriptor)
    const frozenEnabledItems: Readonly<ModelSelectorItem>[] = enabledItems.map((item) =>
      Object.freeze(item),
    );
    const frozenRemainingItems: Readonly<ModelSelectorItem>[] = remainingItems.map((item) =>
      Object.freeze(item),
    );

    this._allItems = Object.freeze([
      this._inheritItem,
      this._manualItem,
      ...frozenEnabledItems,
      ...frozenRemainingItems,
    ]);
    this._items = this._allItems;

    // Set initial selection
    if (options.current !== undefined && options.current !== "") {
      const currentIdx = this._allItems.findIndex(
        (item) => item.kind === "model" && item.key === options.current,
      );
      if (currentIdx !== -1) {
        this._selectedIndex = currentIdx;
        this._currentModelKey = options.current;
      }
    }
  }

  get query(): string {
    return this._query;
  }

  get items(): readonly ModelSelectorItem[] {
    // Return a fresh shallow copy so callers cannot splice or mutate the
    // internal frozen array. The model descriptors inside are frozen too.
    return [...this._items];
  }

  get selectedIndex(): number {
    return this._selectedIndex;
  }

  setQuery(query: string): void {
    const wasCurrentKey = this._items[this._selectedIndex]?.key as
      | string
      | undefined;

    this._query = query;

    if (query === "") {
      this._items = this._allItems;
      // Restore selection: use initial selection policy (current model or inherit)
      if (this._currentModelKey !== undefined) {
        const idx = this._allItems.findIndex(
          (item) => item.key === this._currentModelKey,
        );
        this._selectedIndex = idx !== -1 ? idx : 0;
      } else {
        this._selectedIndex = 0;
      }
      return;
    }

    const filtered: ModelSelectorItem[] = [
      this._inheritItem,
      this._manualItem,
    ];

    for (const item of this._allItems) {
      if (item.kind !== "model") continue;
      if (modelMatchesQuery(item.model, query)) {
        filtered.push(item);
      }
    }

    // Sort filtered model items: enabled first, then non-enabled.
    // Within each group, preserve existing order from _allItems.
    const enabledModels: ModelSelectorItem[] = [];
    const disabledModels: ModelSelectorItem[] = [];
    for (const item of filtered) {
      if (item.kind === "model") {
        if (item.enabled) {
          enabledModels.push(item);
        } else {
          disabledModels.push(item);
        }
      }
    }

    this._items = Object.freeze([
      this._inheritItem,
      this._manualItem,
      ...enabledModels,
      ...disabledModels,
    ]);

    // Retain selection if key still visible, otherwise first matching model
    const retainedIdx = this._items.findIndex(
      (item) => item.key === wasCurrentKey,
    );
    if (retainedIdx !== -1) {
      this._selectedIndex = retainedIdx;
    } else {
      // First matching model (after pinned actions)
      this._selectedIndex = this._items.length > 2 ? 2 : 0;
    }
  }

  move(delta: -1 | 1): void {
    const len = this._items.length;
    if (len === 0) return;
    this._selectedIndex =
      (((this._selectedIndex + delta) % len) + len) % len;
  }

  selected(): ModelSelectorItem | undefined {
    return this._items[this._selectedIndex];
  }

  selection(): ModelSelection | undefined {
    const item = this.selected();
    if (!item) return undefined;
    switch (item.kind) {
      case "inherit":
        return { kind: "inherit" };
      case "manual":
        return { kind: "manual" };
      case "model":
        return { kind: "model", value: item.key };
    }
  }
}