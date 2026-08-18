/**
 * Handler-level tests for the agent-config command.
 *
 * These tests invoke the default extension factory with a fake ExtensionAPI,
 * capture the registered command handler, and exercise it with instrumented
 * contexts to verify behaviour for every edge case in the spec.
 */

import { describe, expect, it, vi, type Mock } from "vitest";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionUIContext,
  ModelRegistry,
} from "@earendil-works/pi-coding-agent";
import type {
  AgentSource,
  BuiltinLoadResult,
  AgentConfigWorkflowDependencies,
  AgentConfigWorkflowResult,
} from "../src/types.js";

// We import the factory so we can inject deps.
import { createAgentConfigExtension, type ReadPatternsResult, type LoadAvailableModelsResult } from "../index.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Captured command registration. */
interface CapturedCommand {
  name: string;
  description: string | undefined;
  handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
}

/** Build a fake ExtensionAPI that captures registerCommand calls. */
function makeFakeApi(): {
  api: ExtensionAPI;
  commands: CapturedCommand[];
  registerToolSpy: Mock;
} {
  const commands: CapturedCommand[] = [];
  const registerToolSpy = vi.fn();
  const api = {
    registerCommand(name: string, options: any) {
      commands.push({
        name,
        description: options.description,
        handler: options.handler,
      });
    },
    registerTool: registerToolSpy,
    // Stub the rest of ExtensionAPI so we don't crash
    on: vi.fn(),
    registerShortcut: vi.fn(),
    registerFlag: vi.fn(),
    getFlag: vi.fn(),
    registerMessageRenderer: vi.fn(),
    registerEntryRenderer: vi.fn(),
    sendMessage: vi.fn(),
    sendUserMessage: vi.fn(),
    appendEntry: vi.fn(),
    setSessionName: vi.fn(),
    getSessionName: vi.fn(),
    exec: vi.fn(),
    getActiveTools: vi.fn(),
    getAllTools: vi.fn(),
    setActiveTools: vi.fn(),
    getCommands: vi.fn(),
    setModel: vi.fn(),
    getThinkingLevel: vi.fn(),
    setThinkingLevel: vi.fn(),
    registerProvider: vi.fn(),
    unregisterProvider: vi.fn(),
    events: { on: vi.fn(), emit: vi.fn(), off: vi.fn() },
  } as unknown as ExtensionAPI;
  return { api, commands, registerToolSpy };
}

function makeFakeModelRegistry(
  models: Array<{ provider: string; id: string; name?: string }> = [],
): ModelRegistry {
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

/** Track-ordered events in an instrumented context. */
interface OrderedContext {
  ctx: ExtensionCommandContext;
  events: string[];
  getReloadCount(): number;
}

function makeOrderedContext(
  overrides?: Partial<ExtensionCommandContext>,
): OrderedContext {
  const events: string[] = [];
  let reloadCount = 0;
  const ctx = {
    ui: {
      select: async () => undefined,
      input: async () => undefined,
      confirm: async () => false,
      notify: (message: string, level: string) => {
        events.push(`notify:${level}:${message}`);
      },
    } as unknown as ExtensionUIContext,
    cwd: "/test/project",
    modelRegistry: makeFakeModelRegistry(),
    isProjectTrusted: () => true,
    reload: async () => {
      reloadCount++;
      events.push("reload");
    },
    ...overrides,
  } as ExtensionCommandContext;
  return { ctx, events, getReloadCount: () => reloadCount };
}

function makeFakeModel(
  provider: string,
  id: string,
  name?: string,
) {
  return { provider, id, name: name ?? id };
}

// ---------------------------------------------------------------------------
// Default deps factories (for tests that use the real internal functions)
// ---------------------------------------------------------------------------

function makeDefaultDeps() {
  return {
    loadBuiltinAgentSources: async (): Promise<BuiltinLoadResult> => ({
      sources: [],
    }),
    readEnabledModelPatterns: async (): Promise<ReadPatternsResult> => ({
      patterns: undefined,
      warnings: [],
    }),
    loadAvailableModels: async (): Promise<LoadAvailableModelsResult> => ({
      models: [],
    }),
    buildWorkflowDependencies: (
      _ctx: ExtensionCommandContext,
      _configDir: string,
      builtinSources: AgentSource[],
      enabledModelPatterns: string[] | undefined,
      allModels: any,
    ): AgentConfigWorkflowDependencies => ({
      ui: _ctx.ui as any,
      cwd: _ctx.cwd,
      configDir: _configDir,
      allModels: allModels ?? [],
      enabledModelPatterns,
      builtinSources,
    }),
    runAgentConfigWorkflow: async (): Promise<AgentConfigWorkflowResult> => ({
      saved: false,
      reloadRequired: false,
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("agentConfigExtension registration", () => {
  it("registers the 'agent-config' command with correct description", () => {
    const { api, commands, registerToolSpy } = makeFakeApi();
    const ext = createAgentConfigExtension();
    ext(api);

    expect(commands).toHaveLength(1);
    expect(commands[0].name).toBe("agent-config");
    expect(commands[0].description).toBe(
      "Configure subagent model, thinking level, and maximum turns",
    );
    expect(typeof commands[0].handler).toBe("function");
    expect(registerToolSpy).not.toHaveBeenCalled();
  });

  it("does not call registerTool", () => {
    const { api, registerToolSpy } = makeFakeApi();
    const ext = createAgentConfigExtension();
    ext(api);
    expect(registerToolSpy).not.toHaveBeenCalled();
  });
});

describe("handler: args handling", () => {
  it("trims args and passes to workflow", async () => {
    const { api, commands } = makeFakeApi();
    const capturedRequestedAgent: string[] = [];
    const deps = {
      ...makeDefaultDeps(),
      runAgentConfigWorkflow: async (
        requestedAgent: string | undefined,
      ): Promise<AgentConfigWorkflowResult> => {
        capturedRequestedAgent.push(requestedAgent ?? "(undefined)");
        return { saved: false, reloadRequired: false };
      },
    };
    const ext = createAgentConfigExtension(deps);
    ext(api);

    const { ctx } = makeOrderedContext();
    await commands[0].handler("  my-agent  ", ctx);
    expect(capturedRequestedAgent).toEqual(["my-agent"]);
  });

  it("passes undefined when args is blank", async () => {
    const { api, commands } = makeFakeApi();
    const capturedRequestedAgent: string[] = [];
    const deps = {
      ...makeDefaultDeps(),
      runAgentConfigWorkflow: async (
        requestedAgent: string | undefined,
      ): Promise<AgentConfigWorkflowResult> => {
        capturedRequestedAgent.push(requestedAgent ?? "(undefined)");
        return { saved: false, reloadRequired: false };
      },
    };
    const ext = createAgentConfigExtension(deps);
    ext(api);

    const { ctx } = makeOrderedContext();
    await commands[0].handler("   ", ctx);
    expect(capturedRequestedAgent).toEqual(["(undefined)"]);
  });

  it("passes undefined when args is empty string", async () => {
    const { api, commands } = makeFakeApi();
    const capturedRequestedAgent: string[] = [];
    const deps = {
      ...makeDefaultDeps(),
      runAgentConfigWorkflow: async (
        requestedAgent: string | undefined,
      ): Promise<AgentConfigWorkflowResult> => {
        capturedRequestedAgent.push(requestedAgent ?? "(undefined)");
        return { saved: false, reloadRequired: false };
      },
    };
    const ext = createAgentConfigExtension(deps);
    ext(api);

    const { ctx } = makeOrderedContext();
    await commands[0].handler("", ctx);
    expect(capturedRequestedAgent).toEqual(["(undefined)"]);
  });
});

describe("handler: builtin warning surfaced", () => {
  it("surfaces builtin loader warning via notify", async () => {
    const { api, commands } = makeFakeApi();
    const BUILTIN_WARNING = "2 built-in agent definition(s) could not be loaded";
    const deps = {
      ...makeDefaultDeps(),
      loadBuiltinAgentSources: async (): Promise<BuiltinLoadResult> => ({
        sources: [{ name: "explore", kind: "builtin" as const, content: "---\n---\n" }],
        warning: BUILTIN_WARNING,
      }),
    };
    const ext = createAgentConfigExtension(deps);
    ext(api);

    const { ctx, events } = makeOrderedContext();
    await commands[0].handler("", ctx);

    expect(events.some((e) => e.includes("warning") && e.includes(BUILTIN_WARNING))).toBe(true);
  });

  it("passes builtin sources to workflow deps", async () => {
    const { api, commands } = makeFakeApi();
    const BUILTIN_SOURCES: AgentSource[] = [
      { name: "explore", kind: "builtin" as const, content: "---\n---\n" },
    ];
    const capturedSources: AgentSource[][] = [];
    const deps = {
      ...makeDefaultDeps(),
      loadBuiltinAgentSources: async (): Promise<BuiltinLoadResult> => ({
        sources: BUILTIN_SOURCES,
      }),
      buildWorkflowDependencies: (
        ctx: ExtensionCommandContext,
        configDir: string,
        builtinSources: AgentSource[],
        enabledModelPatterns: string[] | undefined,
      ): AgentConfigWorkflowDependencies => {
        capturedSources.push(builtinSources);
        return {
          ui: ctx.ui as any,
          cwd: ctx.cwd,
          configDir,
          allModels: [],
          enabledModelPatterns,
          builtinSources,
        };
      },
    };
    const ext = createAgentConfigExtension(deps);
    ext(api);

    const { ctx } = makeOrderedContext();
    await commands[0].handler("", ctx);

    expect(capturedSources).toEqual([BUILTIN_SOURCES]);
  });
});

describe("handler: settings warnings surfaced", () => {
  it("surfaces settings warnings via notify", async () => {
    const { api, commands } = makeFakeApi();
    const SETTINGS_WARNING = "Global settings enabledModels contains non-string entries";
    const deps = {
      ...makeDefaultDeps(),
      readEnabledModelPatterns: async (): Promise<ReadPatternsResult> => ({
        patterns: ["claude-*"],
        warnings: [SETTINGS_WARNING],
      }),
    };
    const ext = createAgentConfigExtension(deps);
    ext(api);

    const { ctx, events } = makeOrderedContext();
    await commands[0].handler("", ctx);

    expect(events.some((e) => e.includes("warning") && e.includes(SETTINGS_WARNING))).toBe(true);
  });
});

describe("handler: cancel / unsaved => no reload", () => {
  it("cancelled workflow does not call reload", async () => {
    const { api, commands } = makeFakeApi();
    const deps = {
      ...makeDefaultDeps(),
      runAgentConfigWorkflow: async (): Promise<AgentConfigWorkflowResult> => ({
        saved: false,
        reloadRequired: false,
      }),
    };
    const ext = createAgentConfigExtension(deps);
    ext(api);

    const { ctx, events } = makeOrderedContext();
    await commands[0].handler("", ctx);

    expect(events.filter((e) => e === "reload")).toHaveLength(0);
  });

  it("unsaved (saved=false) does not call reload", async () => {
    const { api, commands } = makeFakeApi();
    const deps = {
      ...makeDefaultDeps(),
      runAgentConfigWorkflow: async (): Promise<AgentConfigWorkflowResult> => ({
        saved: false,
        reloadRequired: true,
      }),
    };
    const ext = createAgentConfigExtension(deps);
    ext(api);

    const { ctx, events } = makeOrderedContext();
    await commands[0].handler("", ctx);

    expect(events.filter((e) => e === "reload")).toHaveLength(0);
  });
});

describe("handler: saved + reloadRequired => exactly one reload", () => {
  it("calls reload exactly once when saved and reloadRequired", async () => {
    const { api, commands } = makeFakeApi();
    const deps = {
      ...makeDefaultDeps(),
      runAgentConfigWorkflow: async (): Promise<AgentConfigWorkflowResult> => ({
        saved: true,
        reloadRequired: true,
      }),
    };
    const ext = createAgentConfigExtension(deps);
    ext(api);

    const { ctx, events } = makeOrderedContext();
    await commands[0].handler("", ctx);

    expect(events).toContain("reload");
    expect(events.filter((e) => e === "reload")).toHaveLength(1);
  });

  it("reload is the last event when saved and reloadRequired", async () => {
    const { api, commands } = makeFakeApi();
    const deps = {
      ...makeDefaultDeps(),
      runAgentConfigWorkflow: async (): Promise<AgentConfigWorkflowResult> => ({
        saved: true,
        reloadRequired: true,
      }),
    };
    const ext = createAgentConfigExtension(deps);
    ext(api);

    const { ctx, events } = makeOrderedContext();
    await commands[0].handler("", ctx);

    // The last event should be "reload"
    const lastEvent = events[events.length - 1];
    expect(lastEvent).toBe("reload");
  });

  it("no events after reload", async () => {
    const { api, commands } = makeFakeApi();
    const deps = {
      ...makeDefaultDeps(),
      runAgentConfigWorkflow: async (): Promise<AgentConfigWorkflowResult> => ({
        saved: true,
        reloadRequired: true,
      }),
    };
    const ext = createAgentConfigExtension(deps);
    ext(api);

    const { ctx, events } = makeOrderedContext();
    await commands[0].handler("", ctx);

    const reloadIdx = events.lastIndexOf("reload");
    expect(reloadIdx).toBeGreaterThanOrEqual(0);
    // No events after reload
    expect(reloadIdx).toBe(events.length - 1);
  });
});

describe("handler: workflow error => error notify / no reload", () => {
  it("notifies error when workflow throws", async () => {
    const { api, commands } = makeFakeApi();
    const deps = {
      ...makeDefaultDeps(),
      runAgentConfigWorkflow: async (): Promise<AgentConfigWorkflowResult> => {
        throw new Error("WORKFLOW_BOOM");
      },
    };
    const ext = createAgentConfigExtension(deps);
    ext(api);

    const { ctx, events } = makeOrderedContext();
    await commands[0].handler("", ctx);

    expect(events.some((e) => e.includes("error") && e.includes("WORKFLOW_BOOM"))).toBe(true);
    expect(events.filter((e) => e === "reload")).toHaveLength(0);
  });

  it("does not call reload after workflow error", async () => {
    const { api, commands } = makeFakeApi();
    const deps = {
      ...makeDefaultDeps(),
      runAgentConfigWorkflow: async (): Promise<AgentConfigWorkflowResult> => {
        throw new Error("WORKFLOW_BOOM");
      },
    };
    const ext = createAgentConfigExtension(deps);
    ext(api);

    const { ctx, events } = makeOrderedContext();
    await commands[0].handler("", ctx);

    expect(events.filter((e) => e === "reload")).toHaveLength(0);
  });
});

describe("handler: builtin loader unexpected throw => caught, continue", () => {
  it("catches builtin loader throw and notifies warning", async () => {
    const { api, commands } = makeFakeApi();
    const deps = {
      ...makeDefaultDeps(),
      loadBuiltinAgentSources: async (): Promise<BuiltinLoadResult> => {
        throw new Error("BUILTIN_LOADER_BOOM");
      },
    };
    const ext = createAgentConfigExtension(deps);
    ext(api);

    const { ctx, events } = makeOrderedContext();
    // Should not throw
    await commands[0].handler("", ctx);

    expect(
      events.some(
        (e) =>
          e.includes("warning") &&
          (e.includes("BUILTIN_LOADER_BOOM") || e.includes("built-in")),
      ),
    ).toBe(true);
  });

  it("uses empty sources when builtin loader throws", async () => {
    const { api, commands } = makeFakeApi();
    const capturedSources: AgentSource[][] = [];
    const deps = {
      ...makeDefaultDeps(),
      loadBuiltinAgentSources: async (): Promise<BuiltinLoadResult> => {
        throw new Error("BUILTIN_LOADER_BOOM");
      },
      buildWorkflowDependencies: (
        ctx: ExtensionCommandContext,
        configDir: string,
        builtinSources: AgentSource[],
        enabledModelPatterns: string[] | undefined,
      ): AgentConfigWorkflowDependencies => {
        capturedSources.push(builtinSources);
        return {
          ui: ctx.ui as any,
          cwd: ctx.cwd,
          configDir,
          allModels: [],
          enabledModelPatterns,
          builtinSources,
        };
      },
    };
    const ext = createAgentConfigExtension(deps);
    ext(api);

    const { ctx } = makeOrderedContext();
    await commands[0].handler("", ctx);

    expect(capturedSources).toEqual([[]]);
  });

  it("continues to workflow after builtin loader throw", async () => {
    const { api, commands } = makeFakeApi();
    let workflowCalled = false;
    const deps = {
      ...makeDefaultDeps(),
      loadBuiltinAgentSources: async (): Promise<BuiltinLoadResult> => {
        throw new Error("BUILTIN_LOADER_BOOM");
      },
      runAgentConfigWorkflow: async (): Promise<AgentConfigWorkflowResult> => {
        workflowCalled = true;
        return { saved: false, reloadRequired: false };
      },
    };
    const ext = createAgentConfigExtension(deps);
    ext(api);

    const { ctx } = makeOrderedContext();
    await commands[0].handler("", ctx);

    expect(workflowCalled).toBe(true);
  });
});

describe("handler: dependency build failure / loadAvailableModels throw => error notify", () => {
  it("catches buildWorkflowDependencies throw and notifies error", async () => {
    const { api, commands } = makeFakeApi();
    const deps = {
      ...makeDefaultDeps(),
      buildWorkflowDependencies: (): AgentConfigWorkflowDependencies => {
        throw new Error("BUILD_DEPS_BOOM");
      },
    };
    const ext = createAgentConfigExtension(deps);
    ext(api);

    const { ctx, events } = makeOrderedContext();
    await commands[0].handler("", ctx);

    expect(
      events.some((e) => e.includes("error") && e.includes("BUILD_DEPS_BOOM")),
    ).toBe(true);
    expect(events.filter((e) => e === "reload")).toHaveLength(0);
  });

  it("notifies error when loadAvailableModels throws (refresh+getAvailable failure)", async () => {
    const { api, commands } = makeFakeApi();
    const deps = {
      ...makeDefaultDeps(),
      loadAvailableModels: async (): Promise<LoadAvailableModelsResult> => {
        throw new Error("LOAD_AVAILABLE_BOOM");
      },
    };
    const ext = createAgentConfigExtension(deps);
    ext(api);

    const { ctx, events } = makeOrderedContext();
    await commands[0].handler("", ctx);

    expect(
      events.some((e) => e.includes("error") && e.includes("LOAD_AVAILABLE_BOOM")),
    ).toBe(true);
    expect(events.filter((e) => e === "reload")).toHaveLength(0);
  });
});

describe("handler: reload is terminal", () => {
  it("returns immediately after reload (no further side effects)", async () => {
    const { api, commands } = makeFakeApi();
    const deps = {
      ...makeDefaultDeps(),
      runAgentConfigWorkflow: async (): Promise<AgentConfigWorkflowResult> => ({
        saved: true,
        reloadRequired: true,
      }),
    };
    const ext = createAgentConfigExtension(deps);
    ext(api);

    const { ctx, events } = makeOrderedContext();
    // Add a counter to verify nothing after handler completes
    await commands[0].handler("", ctx);

    // reload is the last event
    expect(events[events.length - 1]).toBe("reload");
    // reload appears exactly once
    expect(events.filter((e) => e === "reload")).toHaveLength(1);
  });
});

describe("handler: readEnabledModelPatterns throw => caught, continues", () => {
  it("catches settings read throw and notifies warning", async () => {
    const { api, commands } = makeFakeApi();
    const deps = {
      ...makeDefaultDeps(),
      readEnabledModelPatterns: async (): Promise<ReadPatternsResult> => {
        throw new Error("SETTINGS_READ_BOOM");
      },
    };
    const ext = createAgentConfigExtension(deps);
    ext(api);

    const { ctx, events } = makeOrderedContext();
    await commands[0].handler("", ctx);

    expect(
      events.some(
        (e) =>
          e.includes("warning") &&
          (e.includes("SETTINGS_READ_BOOM") || e.includes("settings")),
      ),
    ).toBe(true);
  });

  it("continues to workflow after settings read throw", async () => {
    const { api, commands } = makeFakeApi();
    let workflowCalled = false;
    const deps = {
      ...makeDefaultDeps(),
      readEnabledModelPatterns: async (): Promise<ReadPatternsResult> => {
        throw new Error("SETTINGS_READ_BOOM");
      },
      runAgentConfigWorkflow: async (): Promise<AgentConfigWorkflowResult> => {
        workflowCalled = true;
        return { saved: false, reloadRequired: false };
      },
    };
    const ext = createAgentConfigExtension(deps);
    ext(api);

    const { ctx } = makeOrderedContext();
    await commands[0].handler("", ctx);

    expect(workflowCalled).toBe(true);
  });
});

describe("handler: context hasUI and ui.custom integration", () => {
  it("buildWorkflowDependencies receives hasUI=true from the real handler context", async () => {
    const { api, commands } = makeFakeApi();
    let capturedHasUI: boolean | undefined;

    const deps = {
      ...makeDefaultDeps(),
      buildWorkflowDependencies: (
        ctx: ExtensionCommandContext,
        configDir: string,
        builtinSources: AgentSource[],
        enabledModelPatterns: string[] | undefined,
        allModels: any,
      ): AgentConfigWorkflowDependencies => {
        capturedHasUI = ctx.hasUI;
        return {
          ui: ctx.ui as any,
          cwd: ctx.cwd,
          configDir,
          allModels: allModels ?? [],
          enabledModelPatterns,
          builtinSources,
        };
      },
    };
    const ext = createAgentConfigExtension(deps);
    ext(api);

    const { ctx } = makeOrderedContext({
      hasUI: true,
    });
    await commands[0].handler("", ctx);

    // The context passed to the handler should have hasUI
    expect(capturedHasUI).toBe(true);
  });

  it("handler passes ui.custom to the workflow via buildDeps", async () => {
    const { api, commands } = makeFakeApi();
    let capturedCustomFn: unknown;

    const deps = {
      ...makeDefaultDeps(),
      buildWorkflowDependencies: (
        ctx: ExtensionCommandContext,
        configDir: string,
        builtinSources: AgentSource[],
        enabledModelPatterns: string[] | undefined,
        allModels: any,
      ): AgentConfigWorkflowDependencies => {
        capturedCustomFn = (ctx.ui as any).custom;
        return {
          ui: ctx.ui as any,
          cwd: ctx.cwd,
          configDir,
          allModels: allModels ?? [],
          enabledModelPatterns,
          builtinSources,
        };
      },
    };
    const ext = createAgentConfigExtension(deps);
    ext(api);

    const { ctx } = makeOrderedContext({
      hasUI: true,
      ui: {
        select: async () => undefined,
        input: async () => undefined,
        confirm: async () => false,
        notify: () => {},
        custom: async () => undefined,
      } as any,
    });
    await commands[0].handler("", ctx);

    expect(capturedCustomFn).toBeDefined();
    expect(typeof capturedCustomFn).toBe("function");
  });
});

describe("handler: loadAvailableModels integration", () => {
  it("calls loadAvailableModels before buildWorkflowDependencies", async () => {
    const { api, commands } = makeFakeApi();
    const callOrder: string[] = [];
    const loadedModels = [
      makeFakeModel("anthropic", "claude-sonnet"),
    ];

    let capturedAllModels: any = undefined;

    const deps = {
      ...makeDefaultDeps(),
      loadAvailableModels: async (): Promise<LoadAvailableModelsResult> => {
        callOrder.push("loadAvailableModels");
        return { models: loadedModels };
      },
      buildWorkflowDependencies: (
        ctx: ExtensionCommandContext,
        configDir: string,
        builtinSources: AgentSource[],
        enabledModelPatterns: string[] | undefined,
        allModels: any,
      ): AgentConfigWorkflowDependencies => {
        callOrder.push("buildWorkflowDependencies");
        capturedAllModels = allModels;
        return {
          ui: ctx.ui as any,
          cwd: ctx.cwd,
          configDir,
          allModels: allModels ?? [],
          enabledModelPatterns,
          builtinSources,
        };
      },
    };
    const ext = createAgentConfigExtension(deps);
    ext(api);

    const { ctx } = makeOrderedContext();
    await commands[0].handler("", ctx);

    expect(callOrder).toEqual(["loadAvailableModels", "buildWorkflowDependencies"]);
    expect(capturedAllModels).toEqual(loadedModels);
  });

  it("calls refresh exactly once per invocation", async () => {
    const { api, commands } = makeFakeApi();
    let refreshCount = 0;

    const deps = {
      ...makeDefaultDeps(),
      loadAvailableModels: async (): Promise<LoadAvailableModelsResult> => {
        refreshCount++;
        return { models: [] };
      },
    };
    const ext = createAgentConfigExtension(deps);
    ext(api);

    const { ctx } = makeOrderedContext();
    await commands[0].handler("", ctx);

    expect(refreshCount).toBe(1);
  });

  it("surfaces refresh warning via notify", async () => {
    const { api, commands } = makeFakeApi();
    const REFRESH_WARNING = "Model catalog refresh failed; showing cached available models.";

    const deps = {
      ...makeDefaultDeps(),
      loadAvailableModels: async (): Promise<LoadAvailableModelsResult> => ({
        models: [makeFakeModel("anthropic", "claude-sonnet")],
        warning: REFRESH_WARNING,
      }),
    };
    const ext = createAgentConfigExtension(deps);
    ext(api);

    const { ctx, events } = makeOrderedContext();
    await commands[0].handler("", ctx);

    expect(events.some((e) => e.includes("warning") && e.includes(REFRESH_WARNING))).toBe(true);
  });

  it("passes available models (not getAll) into workflow deps", async () => {
    const { api, commands } = makeFakeApi();
    const availableModels = [
      makeFakeModel("anthropic", "claude-sonnet"),
    ];

    let capturedAllModels: any = undefined;

    const deps = {
      ...makeDefaultDeps(),
      loadAvailableModels: async (): Promise<LoadAvailableModelsResult> => ({
        models: availableModels,
      }),
      buildWorkflowDependencies: (
        ctx: ExtensionCommandContext,
        configDir: string,
        builtinSources: AgentSource[],
        enabledModelPatterns: string[] | undefined,
        allModels: any,
      ): AgentConfigWorkflowDependencies => {
        capturedAllModels = allModels;
        return {
          ui: ctx.ui as any,
          cwd: ctx.cwd,
          configDir,
          allModels: allModels ?? [],
          enabledModelPatterns,
          builtinSources,
        };
      },
    };
    const ext = createAgentConfigExtension(deps);
    ext(api);

    const { ctx } = makeOrderedContext();
    await commands[0].handler("", ctx);

    expect(capturedAllModels).toEqual(availableModels);
  });

  it("loadAvailableModels failure does not proceed to workflow", async () => {
    const { api, commands } = makeFakeApi();
    let workflowCalled = false;

    const deps = {
      ...makeDefaultDeps(),
      loadAvailableModels: async (): Promise<LoadAvailableModelsResult> => {
        throw new Error("UNAVAILABLE_BOOM");
      },
      runAgentConfigWorkflow: async (): Promise<AgentConfigWorkflowResult> => {
        workflowCalled = true;
        return { saved: false, reloadRequired: false };
      },
    };
    const ext = createAgentConfigExtension(deps);
    ext(api);

    const { ctx } = makeOrderedContext();
    await commands[0].handler("", ctx);

    expect(workflowCalled).toBe(false);
  });

  it("loadAvailableModels failure does not call reload", async () => {
    const { api, commands } = makeFakeApi();

    const deps = {
      ...makeDefaultDeps(),
      loadAvailableModels: async (): Promise<LoadAvailableModelsResult> => {
        throw new Error("UNAVAILABLE_BOOM");
      },
    };
    const ext = createAgentConfigExtension(deps);
    ext(api);

    const { ctx, events } = makeOrderedContext();
    await commands[0].handler("", ctx);

    expect(events.filter((e) => e === "reload")).toHaveLength(0);
  });
});

describe("handler: cancellation no reload regression", () => {
  it("cancelled workflow (saved=false) does not trigger reload", async () => {
    const { api, commands } = makeFakeApi();
    let reloadCount = 0;

    const deps = {
      ...makeDefaultDeps(),
      runAgentConfigWorkflow: async (): Promise<AgentConfigWorkflowResult> => ({
        saved: false,
        reloadRequired: false,
      }),
    };
    const ext = createAgentConfigExtension(deps);
    ext(api);

    const { ctx } = makeOrderedContext({
      reload: async () => {
        reloadCount++;
      },
    });
    await commands[0].handler("", ctx);

    expect(reloadCount).toBe(0);
  });

  it("cancelled workflow does not call reload even when reloadRequired is true", async () => {
    const { api, commands } = makeFakeApi();
    let reloadCount = 0;

    const deps = {
      ...makeDefaultDeps(),
      runAgentConfigWorkflow: async (): Promise<AgentConfigWorkflowResult> => ({
        saved: false,
        reloadRequired: true,
      }),
    };
    const ext = createAgentConfigExtension(deps);
    ext(api);

    const { ctx } = makeOrderedContext({
      reload: async () => {
        reloadCount++;
      },
    });
    await commands[0].handler("", ctx);

    expect(reloadCount).toBe(0);
  });
});