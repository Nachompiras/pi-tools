/**
 * Agent Config Extension
 *
 * Registers the `/agent-config [agent-name]` command that provides an
 * interactive dashboard for configuring a subagent's model, thinking level,
 * and maximum turns.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  AgentConfigUi,
  AgentConfigWorkflowDependencies,
  AgentConfigWorkflowResult,
  AgentSource,
  BuiltinLoadResult,
  ModelDescriptor,
  ModelSelection,
  ModelSelectorOptions,
} from "./src/types.js";
import { loadBuiltinAgentSources as _loadBuiltinAgentSources } from "./src/builtins.js";
import { runAgentConfigWorkflow as _runAgentConfigWorkflow } from "./src/workflow.js";
import { showSearchableModelSelector } from "./src/ui-adapter.js";

// ---------------------------------------------------------------------------
// modelDescriptorFromPiModel
// ---------------------------------------------------------------------------

/**
 * Minimal shape of a Pi Model object returned by modelRegistry.getAvailable().
 * We only need provider, id, and optional name.
 */
interface PiModel {
  provider: string;
  id: string;
  name?: string;
}

/**
 * Convert a Pi Model to a ModelDescriptor used by the config workflow.
 */
export function modelDescriptorFromPiModel(model: PiModel): ModelDescriptor {
  return {
    provider: model.provider,
    id: model.id,
    name: model.name ?? model.id,
  };
}

// ---------------------------------------------------------------------------
// ReadPatternsResult (exported for DI contract)
// ---------------------------------------------------------------------------

/**
 * Result from reading enabled model patterns from settings files.
 * Exported so that the DI contract can reference it without importing
 * from internal modules.
 */
export interface ReadPatternsResult {
  patterns?: string[];
  warnings: string[];
}

/**
 * Read enabledModels patterns from global and project settings files.
 *
 * Global settings: `$configDir/settings.json`
 * Project settings: `<cwd>/.pi/settings.json`
 *
 * Project settings are only honored when `isProjectTrusted` is true.
 * When the project `enabledModels` property is explicitly present (including
 * an empty array), it overrides the global value. When absent, the global
 * value is inherited.
 *
 * Malformed JSON and wrong types for `enabledModels` produce warnings and
 * safe fallback behavior.
 */
export async function readEnabledModelPatterns(
  configDir: string,
  cwd: string,
  isProjectTrusted: boolean,
): Promise<ReadPatternsResult> {
  const warnings: string[] = [];

  // -------------------------------------------------------------------------
  // Read global settings
  // -------------------------------------------------------------------------
  let globalPatterns: string[] | undefined;
  const globalSettingsPath = join(configDir, "settings.json");

  try {
    const raw = await readFile(globalSettingsPath, "utf-8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      warnings.push(
        `Global settings file ${globalSettingsPath} contains malformed JSON; ` +
          `enabledModels will be ignored.`,
      );
      parsed = undefined;
    }

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      if ("enabledModels" in obj) {
        const val = obj.enabledModels;
        if (Array.isArray(val)) {
          const validPatterns: string[] = [];
          let hasNonString = false;
          let hasEmpty = false;
          for (const item of val) {
            if (typeof item === "string" && item.trim().length > 0) {
              validPatterns.push(item.trim());
            } else if (typeof item !== "string") {
              hasNonString = true;
            } else {
              hasEmpty = true;
            }
          }
          globalPatterns = validPatterns;
          if (hasNonString) {
            warnings.push(
              "Global settings enabledModels contains non-string entries; " +
                "they have been ignored.",
            );
          }
          if (hasEmpty) {
            warnings.push(
              "Global settings enabledModels contains empty entries; " +
                "they have been ignored.",
            );
          }
        } else {
          warnings.push(
            "Global settings enabledModels must be an array of strings; " +
              `got ${typeof val}. Ignoring enabledModels.`,
          );
        }
      }
    }
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") {
      warnings.push(
        `Failed to read global settings from ${globalSettingsPath}: ` +
          `${(err as Error).message}`,
      );
    }
    // Missing file is fine — no global patterns
  }

  // -------------------------------------------------------------------------
  // Read project settings (only if trusted)
  // -------------------------------------------------------------------------
  if (!isProjectTrusted) {
    return { patterns: globalPatterns, warnings };
  }

  const projectSettingsPath = join(cwd, ".pi", "settings.json");
  let projectHasEnabledModels = false;
  let projectPatterns: string[] | undefined;

  try {
    const raw = await readFile(projectSettingsPath, "utf-8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      warnings.push(
        `Project settings file ${projectSettingsPath} contains malformed JSON; ` +
          `using global enabledModels.`,
      );
      return { patterns: globalPatterns, warnings };
    }

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      if ("enabledModels" in obj) {
        projectHasEnabledModels = true;
        const val = obj.enabledModels;
        if (Array.isArray(val)) {
          const validPatterns: string[] = [];
          let hasNonString = false;
          let hasEmpty = false;
          for (const item of val) {
            if (typeof item === "string" && item.trim().length > 0) {
              validPatterns.push(item.trim());
            } else if (typeof item !== "string") {
              hasNonString = true;
            } else {
              hasEmpty = true;
            }
          }
          projectPatterns = validPatterns;
          if (hasNonString) {
            warnings.push(
              "Project settings enabledModels contains non-string entries; " +
                "they have been ignored.",
            );
          }
          if (hasEmpty) {
            warnings.push(
              "Project settings enabledModels contains empty entries; " +
                "they have been ignored.",
            );
          }
        } else {
          warnings.push(
            "Project settings enabledModels must be an array of strings; " +
              `got ${typeof val}. Using global enabledModels.`,
          );
          return { patterns: globalPatterns, warnings };
        }
      }
    }
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") {
      warnings.push(
        `Failed to read project settings from ${projectSettingsPath}: ` +
          `${(err as Error).message}`,
      );
    }
    // Missing file is fine — inherit global
  }

  if (projectHasEnabledModels) {
    return { patterns: projectPatterns, warnings };
  }

  return { patterns: globalPatterns, warnings };
}

// ---------------------------------------------------------------------------
// LoadAvailableModelsResult and loadAvailableModels
// ---------------------------------------------------------------------------

/**
 * Result from loading available models from the model registry.
 * Aligns with Pi's /model command which uses getAvailable() (configured
 * providers only) rather than getAll() (all providers).
 */
export interface LoadAvailableModelsResult {
  models: ModelDescriptor[];
  warning?: string;
}

/**
 * Load available models from the model registry.
 *
 * Calls ctx.modelRegistry.refresh() bounded by timeoutMs (default 15 s).
 * After refresh completes or the timeout expires, reads
 * ctx.modelRegistry.getAvailable() (configured providers only).
 * This aligns the selector with Pi's /model command which uses the same
 * getAvailable() snapshot.
 *
 * On timeout the unabortable refresh continues in the background (its
 * eventual rejection is caught to avoid an unhandled rejection).
 * On explicit refresh rejection the cached snapshot is returned with a
 * warning.  If getAvailable() throws the error propagates so the
 * existing dependency error path notifies and aborts.
 *
 * Does NOT use getAll() at any point — unconfigured providers are excluded.
 */
export async function loadAvailableModels(
  ctx: ExtensionCommandContext,
  timeoutMs: number = 15_000,
): Promise<LoadAvailableModelsResult> {
  let warning: string | undefined;

  const refreshPromise = ctx.modelRegistry.refresh();

  let timerId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<"timeout">((resolve) => {
    timerId = setTimeout(() => resolve("timeout"), timeoutMs);
  });

  const refreshResult = refreshPromise.then(
    () => "resolved" as const,
    () => "rejected" as const,
  );

  const winner = await Promise.race([refreshResult, timeoutPromise]);

  // Clear the timeout if refresh won the race (avoid timer leak)
  if (timerId !== undefined && winner !== "timeout") {
    clearTimeout(timerId);
  }

  if (winner === "timeout") {
    // Attach a noop catch to the unabortable refresh so a later
    // rejection does not become an unhandled rejection.
    refreshPromise.catch(() => {});
    warning =
      "Model catalog refresh timed out; showing cached available models.";
  } else if (winner === "rejected") {
    warning =
      "Model catalog refresh failed; showing cached available models.";
  }
  // winner === "resolved" → no warning

  // getAvailable() throws → propagate (existing error path handles it)
  const available = ctx.modelRegistry.getAvailable();
  const models: ModelDescriptor[] = available.map((m) =>
    modelDescriptorFromPiModel(m),
  );

  return warning ? { models, warning } : { models };
}

// ---------------------------------------------------------------------------
// buildWorkflowDependencies
// ---------------------------------------------------------------------------

/**
 * Build workflow dependencies from the command context, config directory,
 * built-in sources, enabled model patterns, and preloaded available models.
 *
 * Adapts ctx.ui to AgentConfigUi. The allModels parameter is preloaded
 * by loadAvailableModels() so the catalog is refreshed and aligned with
 * Pi's /model command before the selector is built.
 */
export function buildWorkflowDependencies(
  ctx: ExtensionCommandContext,
  configDir: string,
  builtinSources: AgentSource[],
  enabledModelPatterns: string[] | undefined,
  allModels: ModelDescriptor[],
): AgentConfigWorkflowDependencies {
  const ui: AgentConfigUi = {
    async select(title, options) {
      return ctx.ui.select(title, options);
    },
    async selectModel(options: ModelSelectorOptions): Promise<ModelSelection | undefined> {
      return showSearchableModelSelector(ctx, options);
    },
    async input(title, placeholder) {
      return ctx.ui.input(title, placeholder);
    },
    async confirm(title, message) {
      return ctx.ui.confirm(title, message);
    },
    notify(message, level) {
      ctx.ui.notify(message, level);
    },
  };

  return {
    ui,
    cwd: ctx.cwd,
    configDir,
    allModels,
    enabledModelPatterns,
    builtinSources,
  };
}

// ---------------------------------------------------------------------------
// Injectable dependencies
// ---------------------------------------------------------------------------

/**
 * Injectable dependencies for the agent-config command handler.
 * Each dependency can be replaced by tests to isolate the handler from
 * real filesystem, network, and UI interactions.
 */
export interface AgentConfigHandlerDeps {
  loadBuiltinAgentSources: (
    configDir?: string,
  ) => Promise<BuiltinLoadResult>;
  readEnabledModelPatterns: (
    configDir: string,
    cwd: string,
    isProjectTrusted: boolean,
  ) => Promise<ReadPatternsResult>;
  loadAvailableModels: (
    ctx: ExtensionCommandContext,
  ) => Promise<LoadAvailableModelsResult>;
  buildWorkflowDependencies: (
    ctx: ExtensionCommandContext,
    configDir: string,
    builtinSources: AgentSource[],
    enabledModelPatterns: string[] | undefined,
    allModels: ModelDescriptor[],
  ) => AgentConfigWorkflowDependencies;
  runAgentConfigWorkflow: (
    requestedAgent: string | undefined,
    deps: AgentConfigWorkflowDependencies,
  ) => Promise<AgentConfigWorkflowResult>;
}

/** Default (real) dependency implementations. */
const defaultHandlerDeps: AgentConfigHandlerDeps = {
  loadBuiltinAgentSources: _loadBuiltinAgentSources,
  readEnabledModelPatterns,
  loadAvailableModels,
  buildWorkflowDependencies,
  runAgentConfigWorkflow: _runAgentConfigWorkflow,
};

// ---------------------------------------------------------------------------
// createAgentConfigExtension
// ---------------------------------------------------------------------------

/**
 * Create an agent-config extension factory with optional dependency injection.
 *
 * When called without arguments, uses the real filesystem, built-in loader,
 * and workflow implementations. Tests can inject fakes for every dependency.
 */
export function createAgentConfigExtension(
  deps?: Partial<AgentConfigHandlerDeps>,
): (pi: ExtensionAPI) => void {
  const resolved: AgentConfigHandlerDeps = {
    ...defaultHandlerDeps,
    ...deps,
  };

  return function agentConfigExtension(pi: ExtensionAPI): void {
    pi.registerCommand("agent-config", {
      description:
        "Configure subagent model, thinking level, and maximum turns",
      async handler(args, ctx) {
        // Trim the optional argument; empty means undefined
        const requestedAgent = args.trim() || undefined;

        // Derive config directory
        const configDir =
          process.env.PI_CODING_AGENT_DIR ??
          join(homedir(), ".pi", "agent");

        // Load built-in agent sources (wrapped for safety)
        let builtinResult: BuiltinLoadResult;
        try {
          builtinResult = await resolved.loadBuiltinAgentSources(configDir);
        } catch (err) {
          ctx.ui.notify(
            `Failed to load built-in agent definitions: ${(err as Error).message}`,
            "warning",
          );
          builtinResult = { sources: [] };
        }
        if (builtinResult.warning) {
          ctx.ui.notify(builtinResult.warning, "warning");
        }

        // Read enabled model patterns from settings
        // Use try-catch to ensure the command doesn't crash on settings errors
        let enabledModelPatterns: string[] | undefined;
        try {
          const patternsResult = await resolved.readEnabledModelPatterns(
            configDir,
            ctx.cwd,
            ctx.isProjectTrusted(),
          );
          enabledModelPatterns = patternsResult.patterns;
          for (const warning of patternsResult.warnings) {
            ctx.ui.notify(warning, "warning");
          }
        } catch (err) {
          // Defensive: surface unexpected errors to the user but continue
          ctx.ui.notify(
            `Failed to read settings: ${(err as Error).message}`,
            "warning",
          );
        }

        // Load available models (refresh + getAvailable from configured
        // providers only). This aligns the selector with Pi's /model catalog.
        // Refresh occurs once per /agent-config invocation.
        let availableModelsResult: LoadAvailableModelsResult;
        try {
          availableModelsResult = await resolved.loadAvailableModels(ctx);
        } catch (err) {
          ctx.ui.notify(
            `Failed to load available models: ${(err as Error).message}`,
            "error",
          );
          return;
        }
        if (availableModelsResult.warning) {
          ctx.ui.notify(availableModelsResult.warning, "warning");
        }

        // Build dependencies and run the workflow
        let deps: AgentConfigWorkflowDependencies;
        try {
          deps = resolved.buildWorkflowDependencies(
            ctx,
            configDir,
            builtinResult.sources,
            enabledModelPatterns,
            availableModelsResult.models,
          );
        } catch (err) {
          ctx.ui.notify(
            `Failed to build workflow dependencies: ${(err as Error).message}`,
            "error",
          );
          return;
        }

        let result;
        try {
          result = await resolved.runAgentConfigWorkflow(
            requestedAgent,
            deps,
          );
        } catch (err) {
          // Catch unexpected errors from the workflow itself
          ctx.ui.notify(
            `Agent config workflow failed: ${(err as Error).message}`,
            "error",
          );
          return;
        }

        // Reload resources only after a successful save
        if (result.saved && result.reloadRequired) {
          await ctx.reload();
          return;
        }
      },
    });
  };
}

// ---------------------------------------------------------------------------
// Default export (backward-compatible)
// ---------------------------------------------------------------------------

/**
 * Pi extension entry point. Registers the `/agent-config [agent-name]` command.
 */
export default function agentConfigExtension(pi: ExtensionAPI): void {
  return createAgentConfigExtension()(pi);
}