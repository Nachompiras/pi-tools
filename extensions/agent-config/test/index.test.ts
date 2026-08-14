import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type {
  ExtensionCommandContext,
  ExtensionUIContext,
  ModelRegistry,
} from "@earendil-works/pi-coding-agent";

// Import the module under test and its exported helpers
import {
  readEnabledModelPatterns,
  buildWorkflowDependencies,
  modelDescriptorFromPiModel,
  loadAvailableModels,
} from "../index.js";
import type { LoadAvailableModelsResult } from "../index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "index-test-"));
}

function makeFakeModel(
  provider: string,
  id: string,
  name?: string,
) {
  return { provider, id, name: name ?? id };
}

function makeFakeModelRegistry(models: Array<{ provider: string; id: string; name?: string }>): ModelRegistry {
  return {
    getAll: () => models,
    getAvailable: () => models,
    find: () => undefined,
    hasConfiguredAuth: () => false,
    getApiKeyAndHeaders: async () => ({ ok: false, error: "no auth" }),
    getProviderAuthStatus: () => "unauthenticated" as any,
    getProvider: () => undefined,
    getProviderDisplayName: () => "",
    getProviderAuth: async () => undefined,
    getApiKeyForProvider: async () => undefined,
    isUsingOAuth: () => false,
    registerProvider: () => {},
    unregisterProvider: () => {},
    getRegisteredProviderConfig: () => undefined,
    getRegisteredNativeProvider: () => undefined,
    getRegisteredProviderIds: () => [],
    getError: () => undefined,
    refresh: async () => {},
  } as unknown as ModelRegistry;
}

interface FakeUiCall {
  kind: string;
  title?: string;
  message?: string;
  level?: "info" | "warning" | "error";
}

// ---------------------------------------------------------------------------
// readEnabledModelPatterns tests
// ---------------------------------------------------------------------------

describe("readEnabledModelPatterns", () => {
  it("returns undefined patterns when no settings files exist (no warnings)", async () => {
    const dir = tmpdir();
    try {
      const result = await readEnabledModelPatterns(dir, dir, true);
      expect(result.patterns).toBeUndefined();
      expect(result.warnings).toEqual([]);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("reads patterns from global settings only when project is not trusted", async () => {
    const dir = tmpdir();
    try {
      const globalSettings = path.join(dir, "settings.json");
      await fsp.writeFile(
        globalSettings,
        JSON.stringify({ enabledModels: ["claude-*"] }),
        "utf-8",
      );

      // Project settings exist but project is not trusted
      const cwd = path.join(dir, "project");
      const projectPi = path.join(cwd, ".pi");
      await fsp.mkdir(projectPi, { recursive: true });
      await fsp.writeFile(
        path.join(projectPi, "settings.json"),
        JSON.stringify({ enabledModels: ["gpt-*"] }),
        "utf-8",
      );

      const result = await readEnabledModelPatterns(dir, cwd, false);
      expect(result.patterns).toEqual(["claude-*"]);
      expect(result.warnings).toEqual([]);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("project overrides global when trusted", async () => {
    const dir = tmpdir();
    try {
      const globalSettings = path.join(dir, "settings.json");
      await fsp.writeFile(
        globalSettings,
        JSON.stringify({ enabledModels: ["claude-*"] }),
        "utf-8",
      );

      const cwd = path.join(dir, "project");
      const projectPi = path.join(cwd, ".pi");
      await fsp.mkdir(projectPi, { recursive: true });
      await fsp.writeFile(
        path.join(projectPi, "settings.json"),
        JSON.stringify({ enabledModels: ["gpt-*"] }),
        "utf-8",
      );

      const result = await readEnabledModelPatterns(dir, cwd, true);
      expect(result.patterns).toEqual(["gpt-*"]);
      expect(result.warnings).toEqual([]);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("project absent inherits global when trusted", async () => {
    const dir = tmpdir();
    try {
      const globalSettings = path.join(dir, "settings.json");
      await fsp.writeFile(
        globalSettings,
        JSON.stringify({ enabledModels: ["claude-*"] }),
        "utf-8",
      );

      const cwd = path.join(dir, "project");
      await fsp.mkdir(cwd, { recursive: true });

      const result = await readEnabledModelPatterns(dir, cwd, true);
      expect(result.patterns).toEqual(["claude-*"]);
      expect(result.warnings).toEqual([]);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("explicit empty array [] overrides global", async () => {
    const dir = tmpdir();
    try {
      const globalSettings = path.join(dir, "settings.json");
      await fsp.writeFile(
        globalSettings,
        JSON.stringify({ enabledModels: ["claude-*"] }),
        "utf-8",
      );

      const cwd = path.join(dir, "project");
      const projectPi = path.join(cwd, ".pi");
      await fsp.mkdir(projectPi, { recursive: true });
      await fsp.writeFile(
        path.join(projectPi, "settings.json"),
        JSON.stringify({ enabledModels: [] }),
        "utf-8",
      );

      const result = await readEnabledModelPatterns(dir, cwd, true);
      expect(result.patterns).toEqual([]);
      expect(result.warnings).toEqual([]);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("warns on malformed JSON in global settings", async () => {
    const dir = tmpdir();
    try {
      const globalSettings = path.join(dir, "settings.json");
      await fsp.writeFile(globalSettings, "not json", "utf-8");

      const result = await readEnabledModelPatterns(dir, dir, true);
      expect(result.patterns).toBeUndefined();
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toMatch(/global settings/i);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("warns on malformed JSON in project settings only when trusted", async () => {
    const dir = tmpdir();
    try {
      const globalSettings = path.join(dir, "settings.json");
      await fsp.writeFile(
        globalSettings,
        JSON.stringify({ enabledModels: ["claude-*"] }),
        "utf-8",
      );

      const cwd = path.join(dir, "project");
      const projectPi = path.join(cwd, ".pi");
      await fsp.mkdir(projectPi, { recursive: true });
      await fsp.writeFile(
        path.join(projectPi, "settings.json"),
        "not json",
        "utf-8",
      );

      const result = await readEnabledModelPatterns(dir, cwd, true);
      // Should fall back to global patterns, warn about project
      expect(result.patterns).toEqual(["claude-*"]);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w: string) => w.match(/project settings/i))).toBe(true);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("warns when enabledModels is not an array", async () => {
    const dir = tmpdir();
    try {
      const globalSettings = path.join(dir, "settings.json");
      await fsp.writeFile(
        globalSettings,
        JSON.stringify({ enabledModels: "not-an-array" }),
        "utf-8",
      );

      const result = await readEnabledModelPatterns(dir, dir, true);
      expect(result.patterns).toBeUndefined();
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toMatch(/enabledModels/i);
      expect(result.warnings[0]).toMatch(/array/i);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("warns when enabledModels contains non-string entries", async () => {
    const dir = tmpdir();
    try {
      const globalSettings = path.join(dir, "settings.json");
      await fsp.writeFile(
        globalSettings,
        JSON.stringify({ enabledModels: ["valid", 42, "also-valid"] }),
        "utf-8",
      );

      const result = await readEnabledModelPatterns(dir, dir, true);
      // Should filter to only strings
      expect(result.patterns).toEqual(["valid", "also-valid"]);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toMatch(/non-string/i);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("warns when enabledModels contains empty strings", async () => {
    const dir = tmpdir();
    try {
      const globalSettings = path.join(dir, "settings.json");
      await fsp.writeFile(
        globalSettings,
        JSON.stringify({ enabledModels: ["valid", "", "  "] }),
        "utf-8",
      );

      const result = await readEnabledModelPatterns(dir, dir, true);
      // Should filter empty strings
      expect(result.patterns).toEqual(["valid"]);
      expect(result.warnings.length).toBeGreaterThan(0);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("project property absent inherits global when trusted", async () => {
    const dir = tmpdir();
    try {
      const globalSettings = path.join(dir, "settings.json");
      await fsp.writeFile(
        globalSettings,
        JSON.stringify({ enabledModels: ["claude-*"] }),
        "utf-8",
      );

      const cwd = path.join(dir, "project");
      const projectPi = path.join(cwd, ".pi");
      await fsp.mkdir(projectPi, { recursive: true });
      // Project settings file exists but has no enabledModels key
      await fsp.writeFile(
        path.join(projectPi, "settings.json"),
        JSON.stringify({ theme: "dark" }),
        "utf-8",
      );

      const result = await readEnabledModelPatterns(dir, cwd, true);
      expect(result.patterns).toEqual(["claude-*"]);
      expect(result.warnings).toEqual([]);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// modelDescriptorFromPiModel tests
// ---------------------------------------------------------------------------

describe("modelDescriptorFromPiModel", () => {
  it("converts a Pi model to a descriptor", () => {
    const model = makeFakeModel("anthropic", "claude-sonnet", "Claude Sonnet");
    const desc = modelDescriptorFromPiModel(model);
    expect(desc).toEqual({
      provider: "anthropic",
      id: "claude-sonnet",
      name: "Claude Sonnet",
    });
  });

  it("uses id as name when name is missing", () => {
    const model = makeFakeModel("openai", "gpt-5");
    const desc = modelDescriptorFromPiModel(model);
    expect(desc).toEqual({
      provider: "openai",
      id: "gpt-5",
      name: "gpt-5",
    });
  });
});

// ---------------------------------------------------------------------------
// loadAvailableModels tests
// ---------------------------------------------------------------------------

describe("loadAvailableModels", () => {
  it("calls refresh before getAvailable and returns only available models", async () => {
    const allModels = [
      makeFakeModel("anthropic", "claude-sonnet"),
      makeFakeModel("openai", "gpt-5"),
    ];
    const availableModels = [
      makeFakeModel("anthropic", "claude-sonnet"),
    ];

    let refreshCalled = false;
    let getAvailableCalled = false;
    let getAllCalled = false;

    const fakeRegistry = {
      ...makeFakeModelRegistry(availableModels),
      getAll: () => {
        getAllCalled = true;
        return allModels;
      },
      getAvailable: () => {
        getAvailableCalled = true;
        return availableModels;
      },
      refresh: async () => {
        refreshCalled = true;
      },
    };

    const fakeCtx = {
      modelRegistry: fakeRegistry,
    } as unknown as ExtensionCommandContext;

    const result = await loadAvailableModels(fakeCtx);

    expect(refreshCalled).toBe(true);
    expect(getAvailableCalled).toBe(true);
    expect(getAllCalled).toBe(false);
    expect(result.models).toHaveLength(1);
    expect(result.models[0].provider).toBe("anthropic");
    expect(result.models[0].id).toBe("claude-sonnet");
    expect(result.warning).toBeUndefined();
  });

  it("refresh expands available set: stale snapshot before, expanded after", async () => {
    const staleModels = [
      makeFakeModel("anthropic", "claude-sonnet"),
    ];
    const refreshedModels = [
      makeFakeModel("anthropic", "claude-sonnet"),
      makeFakeModel("anthropic", "claude-opus"),
    ];

    let currentAvailable = staleModels;
    let refreshCalled = false;

    const fakeRegistry = {
      ...makeFakeModelRegistry(staleModels),
      getAvailable: () => currentAvailable,
      refresh: async () => {
        refreshCalled = true;
        // After refresh, the available set expands
        currentAvailable = refreshedModels;
      },
    };

    const fakeCtx = {
      modelRegistry: fakeRegistry,
    } as unknown as ExtensionCommandContext;

    const result = await loadAvailableModels(fakeCtx);

    expect(refreshCalled).toBe(true);
    expect(result.models).toHaveLength(2);
    expect(result.models.map((m) => `${m.provider}/${m.id}`)).toEqual([
      "anthropic/claude-sonnet",
      "anthropic/claude-opus",
    ]);
  });

  it("getAll contains extra unavailable model but must never be called", async () => {
    const availableModels = [
      makeFakeModel("anthropic", "claude-sonnet"),
    ];
    const allModels = [
      ...availableModels,
      makeFakeModel("unconfigured", "secret-model"),
    ];

    let getAllCalled = false;

    const fakeRegistry = {
      ...makeFakeModelRegistry(availableModels),
      getAll: () => {
        getAllCalled = true;
        return allModels;
      },
      getAvailable: () => availableModels,
      refresh: async () => {},
    };

    const fakeCtx = {
      modelRegistry: fakeRegistry,
    } as unknown as ExtensionCommandContext;

    const result = await loadAvailableModels(fakeCtx);

    expect(getAllCalled).toBe(false);
    expect(result.models).toHaveLength(1);
    expect(result.models[0].id).toBe("claude-sonnet");
  });

  it("refresh failure falls back to cached getAvailable with warning", async () => {
    const cachedModels = [
      makeFakeModel("anthropic", "claude-sonnet"),
    ];

    const fakeRegistry = {
      ...makeFakeModelRegistry(cachedModels),
      getAvailable: () => cachedModels,
      refresh: async () => {
        throw new Error("REFRESH_NETWORK_ERROR");
      },
    };

    const fakeCtx = {
      modelRegistry: fakeRegistry,
    } as unknown as ExtensionCommandContext;

    const result = await loadAvailableModels(fakeCtx);

    expect(result.models).toHaveLength(1);
    expect(result.models[0].id).toBe("claude-sonnet");
    expect(result.warning).toBeDefined();
    expect(result.warning).toMatch(/refresh failed/i);
    expect(result.warning).toMatch(/cached/i);
  });

  it("refresh + getAvailable failure propagates", async () => {
    const fakeRegistry = {
      ...makeFakeModelRegistry([]),
      getAvailable: () => {
        throw new Error("GETAVAILABLE_BOOM");
      },
      refresh: async () => {
        throw new Error("REFRESH_BOOM");
      },
    };

    const fakeCtx = {
      modelRegistry: fakeRegistry,
    } as unknown as ExtensionCommandContext;

    await expect(loadAvailableModels(fakeCtx)).rejects.toThrow("GETAVAILABLE_BOOM");
  });

  it("getAvailable failure after successful refresh propagates", async () => {
    const fakeRegistry = {
      ...makeFakeModelRegistry([]),
      getAvailable: () => {
        throw new Error("GETAVAILABLE_POST_REFRESH_BOOM");
      },
      refresh: async () => {
        // refresh succeeds
      },
    };

    const fakeCtx = {
      modelRegistry: fakeRegistry,
    } as unknown as ExtensionCommandContext;

    await expect(loadAvailableModels(fakeCtx)).rejects.toThrow("GETAVAILABLE_POST_REFRESH_BOOM");
  });

  // -----------------------------------------------------------------------
  // Timeout / bounded refresh
  // -----------------------------------------------------------------------

  /** Helper: create a deferred promise that can be resolved/rejected externally. */
  function deferred<T>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason: unknown) => void;
  } {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  describe("timeout", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("pending refresh times out, returns cached available + warning", async () => {
      vi.useFakeTimers();

      const cachedModels = [makeFakeModel("anthropic", "claude-sonnet")];
      const { promise: refreshPromise, resolve: resolveRefresh } =
        deferred<void>();

      let getAvailableCalled = false;
      const fakeRegistry = {
        ...makeFakeModelRegistry(cachedModels),
        getAvailable: () => {
          getAvailableCalled = true;
          return cachedModels;
        },
        refresh: async () => refreshPromise,
      };

      const fakeCtx = {
        modelRegistry: fakeRegistry,
      } as unknown as ExtensionCommandContext;

      // Start loadAvailableModels with a tiny timeout
      const resultPromise = loadAvailableModels(fakeCtx, 100);

      // Advance past the timeout
      await vi.advanceTimersByTimeAsync(150);

      const result = await resultPromise;

      // getAvailable was called after the timeout
      expect(getAvailableCalled).toBe(true);
      expect(result.models).toHaveLength(1);
      expect(result.models[0].id).toBe("claude-sonnet");
      expect(result.warning).toBe(
        "Model catalog refresh timed out; showing cached available models.",
      );

      // Now resolve the refresh — must not cause unhandled rejection
      resolveRefresh();
      await vi.runAllTimersAsync();
    });

    it("timeout: later refresh rejection does not cause unhandled rejection", async () => {
      vi.useFakeTimers();

      const cachedModels = [makeFakeModel("anthropic", "claude-sonnet")];
      const { promise: refreshPromise, reject: rejectRefresh } =
        deferred<void>();

      const fakeRegistry = {
        ...makeFakeModelRegistry(cachedModels),
        getAvailable: () => cachedModels,
        refresh: async () => refreshPromise,
      };

      const fakeCtx = {
        modelRegistry: fakeRegistry,
      } as unknown as ExtensionCommandContext;

      const resultPromise = loadAvailableModels(fakeCtx, 100);
      await vi.advanceTimersByTimeAsync(150);
      const result = await resultPromise;

      expect(result.warning).toContain("timed out");

      // Reject the refresh after timeout — must not cause unhandled rejection
      rejectRefresh(new Error("LATE_REFRESH_REJECTION"));
      await vi.runAllTimersAsync();
      // If we get here without an unhandled rejection, the test passes
    });

    it("success before timeout clears timer and returns no warning", async () => {
      vi.useFakeTimers();

      const freshModels = [
        makeFakeModel("anthropic", "claude-sonnet"),
        makeFakeModel("openai", "gpt-5"),
      ];

      const fakeRegistry = {
        ...makeFakeModelRegistry(freshModels),
        getAvailable: () => freshModels,
        refresh: async () => {
          // resolves immediately
        },
      };

      const fakeCtx = {
        modelRegistry: fakeRegistry,
      } as unknown as ExtensionCommandContext;

      const resultPromise = loadAvailableModels(fakeCtx, 5000);

      // Let the microtask queue flush (refresh resolves synchronously)
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      expect(result.models).toHaveLength(2);
      expect(result.warning).toBeUndefined();
    });

    it("explicit refresh rejection returns cached available + warning", async () => {
      vi.useFakeTimers();

      const cachedModels = [makeFakeModel("anthropic", "claude-sonnet")];

      const fakeRegistry = {
        ...makeFakeModelRegistry(cachedModels),
        getAvailable: () => cachedModels,
        refresh: async () => {
          throw new Error("REFRESH_REJECTED");
        },
      };

      const fakeCtx = {
        modelRegistry: fakeRegistry,
      } as unknown as ExtensionCommandContext;

      const resultPromise = loadAvailableModels(fakeCtx, 5000);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.models).toHaveLength(1);
      expect(result.warning).toBe(
        "Model catalog refresh failed; showing cached available models.",
      );
    });

    it("getAvailable failure after timeout propagates", async () => {
      vi.useFakeTimers();

      const { promise: refreshPromise } = deferred<void>();

      const fakeRegistry = {
        ...makeFakeModelRegistry([]),
        getAvailable: () => {
          throw new Error("GETAVAILABLE_AFTER_TIMEOUT_BOOM");
        },
        refresh: async () => refreshPromise,
      };

      const fakeCtx = {
        modelRegistry: fakeRegistry,
      } as unknown as ExtensionCommandContext;

      const resultPromise = loadAvailableModels(fakeCtx, 100);
      // Set up the rejection handler BEFORE advancing timers so the
      // synchronous throw inside the async function is caught.
      const rejection = expect(resultPromise).rejects.toThrow(
        "GETAVAILABLE_AFTER_TIMEOUT_BOOM",
      );
      await vi.advanceTimersByTimeAsync(150);
      await rejection;
    });

    it("refresh called exactly once", async () => {
      let refreshCount = 0;

      const fakeRegistry = {
        ...makeFakeModelRegistry([]),
        getAvailable: () => [],
        refresh: async () => {
          refreshCount++;
        },
      };

      const fakeCtx = {
        modelRegistry: fakeRegistry,
      } as unknown as ExtensionCommandContext;

      await loadAvailableModels(fakeCtx);

      expect(refreshCount).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// buildWorkflowDependencies tests
// ---------------------------------------------------------------------------

describe("buildWorkflowDependencies", () => {
  it("builds dependencies from context with preloaded allModels", () => {
    const allModels = [
      { provider: "anthropic", id: "claude-sonnet" },
      { provider: "openai", id: "gpt-5" },
    ];

    const fakeRegistry = makeFakeModelRegistry([]);

    const fakeCtx = {
      cwd: "/test/project",
      modelRegistry: fakeRegistry,
      isProjectTrusted: () => true,
      ui: {
        select: async () => undefined,
        input: async () => undefined,
        confirm: async () => false,
        notify: () => {},
      } as unknown as ExtensionUIContext,
    } as unknown as ExtensionCommandContext;

    const configDir = "/test/config";
    const builtinSources = [
      { name: "explore", kind: "builtin" as const, content: "---\n---\n" },
    ];

    const deps = buildWorkflowDependencies(
      fakeCtx,
      configDir,
      builtinSources,
      ["claude-*"],
      allModels,
    );

    expect(deps.cwd).toBe("/test/project");
    expect(deps.configDir).toBe("/test/config");
    expect(deps.allModels).toHaveLength(2);
    expect(deps.allModels[0].provider).toBe("anthropic");
    expect(deps.allModels[1].provider).toBe("openai");
    expect(deps.enabledModelPatterns).toEqual(["claude-*"]);
    expect(deps.builtinSources).toEqual(builtinSources);
    expect(deps.ui).toBeDefined();
    expect(typeof deps.ui.select).toBe("function");
    expect(typeof deps.ui.notify).toBe("function");
  });

  it("does NOT call registry.getAll or registry.getAvailable", () => {
    let getAllCalled = false;
    let getAvailableCalled = false;

    const fakeRegistry = {
      ...makeFakeModelRegistry([]),
      getAll: () => {
        getAllCalled = true;
        return [];
      },
      getAvailable: () => {
        getAvailableCalled = true;
        return [];
      },
    };

    const fakeCtx = {
      cwd: "/test",
      modelRegistry: fakeRegistry,
      isProjectTrusted: () => false,
      ui: {
        select: async () => undefined,
        input: async () => undefined,
        confirm: async () => false,
        notify: () => {},
      } as unknown as ExtensionUIContext,
    } as unknown as ExtensionCommandContext;

    buildWorkflowDependencies(
      fakeCtx,
      "/test",
      [],
      undefined,
      [{ provider: "x", id: "y" }],
    );

    expect(getAllCalled).toBe(false);
    expect(getAvailableCalled).toBe(false);
  });

  it("ui adapter forwards select correctly", async () => {
    const fakeRegistry = makeFakeModelRegistry([]);

    let selectCalled = false;
    const fakeCtx = {
      cwd: "/test",
      modelRegistry: fakeRegistry,
      isProjectTrusted: () => false,
      ui: {
        select: async (title: string, options: string[]) => {
          selectCalled = true;
          expect(title).toBe("Test title");
          expect(options).toEqual(["a", "b"]);
          return "a";
        },
        input: async () => undefined,
        confirm: async () => false,
        notify: () => {},
      } as unknown as ExtensionUIContext,
    } as unknown as ExtensionCommandContext;

    const deps = buildWorkflowDependencies(
      fakeCtx,
      "/test",
      [],
      undefined,
      [],
    );

    const result = await deps.ui.select("Test title", ["a", "b"]);
    expect(selectCalled).toBe(true);
    expect(result).toBe("a");
  });

  it("ui adapter forwards notify correctly", async () => {
    const fakeRegistry = makeFakeModelRegistry([]);

    let notifyCalled = false;
    const fakeCtx = {
      cwd: "/test",
      modelRegistry: fakeRegistry,
      isProjectTrusted: () => false,
      ui: {
        select: async () => undefined,
        input: async () => undefined,
        confirm: async () => false,
        notify: (msg: string, level: "info" | "warning" | "error") => {
          notifyCalled = true;
          expect(msg).toBe("test message");
          expect(level).toBe("warning");
        },
      } as unknown as ExtensionUIContext,
    } as unknown as ExtensionCommandContext;

    const deps = buildWorkflowDependencies(
      fakeCtx,
      "/test",
      [],
      undefined,
      [],
    );

    deps.ui.notify("test message", "warning");
    expect(notifyCalled).toBe(true);
  });

  // -----------------------------------------------------------------------
  // selectModel: uses custom helper (not generic select)
  // -----------------------------------------------------------------------

  it("ui.selectModel invokes ctx.ui.custom with exact options", async () => {
    const fakeRegistry = makeFakeModelRegistry([]);

    let customCalled = false;
    let capturedFactory: unknown = undefined;

    const fakeCtx = {
      cwd: "/test",
      mode: "tui",
      hasUI: true,
      modelRegistry: fakeRegistry,
      isProjectTrusted: () => false,
      ui: {
        select: async () => undefined,
        input: async () => undefined,
        confirm: async () => false,
        notify: () => {},
        custom: async <T>(factory: unknown): Promise<T> => {
          customCalled = true;
          capturedFactory = factory;
          return undefined as T;
        },
      } as unknown as ExtensionUIContext,
    } as unknown as ExtensionCommandContext;

    const deps = buildWorkflowDependencies(
      fakeCtx,
      "/test",
      [],
      undefined,
      [],
    );

    const result = await deps.ui.selectModel({
      enabled: [{ provider: "anthropic", id: "claude-sonnet" }],
      all: [
        { provider: "anthropic", id: "claude-sonnet" },
        { provider: "openai", id: "gpt-5" },
      ],
      current: "anthropic/claude-sonnet",
    });

    expect(customCalled).toBe(true);
    expect(capturedFactory).toBeDefined();
    expect(typeof capturedFactory).toBe("function");
    expect(result).toBeUndefined();
  });

  it("ui.selectModel does NOT call ctx.ui.select for model picking", async () => {
    const fakeRegistry = makeFakeModelRegistry([]);

    let selectCalled = false;
    let customCalled = false;

    const fakeCtx = {
      cwd: "/test",
      mode: "tui",
      hasUI: true,
      modelRegistry: fakeRegistry,
      isProjectTrusted: () => false,
      ui: {
        select: async () => {
          selectCalled = true;
          return undefined;
        },
        input: async () => undefined,
        confirm: async () => false,
        notify: () => {},
        custom: async <T>(_factory: unknown): Promise<T> => {
          customCalled = true;
          return undefined as T;
        },
      } as unknown as ExtensionUIContext,
    } as unknown as ExtensionCommandContext;

    const deps = buildWorkflowDependencies(
      fakeCtx,
      "/test",
      [],
      undefined,
      [],
    );

    await deps.ui.selectModel({
      enabled: [],
      all: [{ provider: "anthropic", id: "claude-sonnet" }],
    });

    expect(customCalled).toBe(true);
    expect(selectCalled).toBe(false);
  });
});