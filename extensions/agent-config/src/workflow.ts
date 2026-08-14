import { resolveAgentDirectories, discoverFileAgents, resolveAgentPrecedence, targetAgentPath, validateAgentName } from "./discovery.js";
import { parseAgentDocument, updateAgentDocument } from "./frontmatter.js";
import { saveAgentDocument } from "./persistence.js";
import { buildModelChoices, validateManualModel } from "./models.js";
import type {
  AgentConfigUi,
  AgentConfigWorkflowDependencies,
  AgentConfigWorkflowResult,
  AgentSource,
  AgentSourceKind,
  DiscoveredAgent,
  EditableAgentConfig,
  ThinkingLevel,
  ModelDescriptor,
  AgentScope,
  ParsedConfigValues,
} from "./types.js";
import { THINKING_LEVELS, isValidThinkingLevel } from "./types.js";

// ---------------------------------------------------------------------------
// Sentinels for special menu options
// ---------------------------------------------------------------------------

const INHERIT = "\x00INHERIT\x00";
const MANUAL = "\x00MANUAL\x00";

// ---------------------------------------------------------------------------
// Label helpers
// ---------------------------------------------------------------------------

interface LabeledOptions {
  options: string[];
  lookup: Map<string, string>;
}

function makeLabeledOptions(entries: Array<{ label: string; value: string }>): LabeledOptions {
  const options = entries.map((e) => e.label);
  const lookup = new Map(entries.map((e) => [e.label, e.value]));
  return { options, lookup };
}

function sourceKindLabel(kind: AgentSourceKind): string {
  switch (kind) {
    case "project-pi":
      return "project .pi/agents";
    case "project-agents":
      return "project .agents/agents";
    case "global":
      return "global";
    case "builtin":
      return "built-in";
  }
}

// ---------------------------------------------------------------------------
// Parse current config values from frontmatter
// ---------------------------------------------------------------------------

function parseCurrentConfig(content: string): ParsedConfigValues {
  let doc;
  try {
    doc = parseAgentDocument(content);
  } catch {
    // If we can't parse, treat as empty
    return { modelMalformed: false, thinkingMalformed: false, maxTurnsMalformed: false };
  }

  const fm = doc.frontmatter;
  const result: ParsedConfigValues = {
    modelMalformed: false,
    thinkingMalformed: false,
    maxTurnsMalformed: false,
  };

  // Parse model
  if ("model" in fm) {
    const v = fm.model;
    if (typeof v === "string" && v.length > 0) {
      result.model = v;
    } else if (v !== undefined && v !== null) {
      result.model = String(v);
      result.modelMalformed = true;
    }
  }

  // Parse thinking
  if ("thinking" in fm) {
    const v = fm.thinking;
    if (typeof v === "string" && v.length > 0) {
      result.thinking = v;
      if (!isValidThinkingLevel(v)) {
        result.thinkingMalformed = true;
      }
    } else if (v !== undefined && v !== null) {
      result.thinking = String(v);
      result.thinkingMalformed = true;
    }
  }

  // Parse max_turns
  if ("max_turns" in fm) {
    const v = fm.max_turns;
    if (typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v > 0) {
      result.maxTurns = v;
    } else if (v !== undefined && v !== null) {
      result.maxTurnsMalformed = true;
      if (typeof v === "number") {
        result.maxTurns = v;
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Format current value display
// ---------------------------------------------------------------------------

function formatCurrentValue(parsed: ParsedConfigValues, field: "model" | "thinking" | "maxTurns"): string {
  switch (field) {
    case "model": {
      if (parsed.model === undefined) return "(not set)";
      const suffix = parsed.modelMalformed ? " [malformed]" : "";
      return `${parsed.model}${suffix}`;
    }
    case "thinking": {
      if (parsed.thinking === undefined) return "(not set)";
      const suffix = parsed.thinkingMalformed ? " [malformed]" : "";
      return `${parsed.thinking}${suffix}`;
    }
    case "maxTurns": {
      if (parsed.maxTurns === undefined) {
        if (parsed.maxTurnsMalformed) return "(malformed)";
        return "(not set)";
      }
      return `${parsed.maxTurns}`;
    }
  }
}

// ---------------------------------------------------------------------------
// Dashboard display
// ---------------------------------------------------------------------------

function formatDashboard(
  parsed: ParsedConfigValues,
  editable: EditableAgentConfig,
  targetLabel: string,
): string {
  const lines = [
    `Model: ${formatCurrentValueEditable(parsed, editable, "model")}`,
    `Thinking: ${formatCurrentValueEditable(parsed, editable, "thinking")}`,
    `Max turns: ${formatCurrentValueEditable(parsed, editable, "maxTurns")}`,
    `Target: ${targetLabel}`,
  ];
  return lines.join("\n");
}

/**
 * Compute the effective display value for a field, distinguishing between:
 * - Untouched (use parsed value from file)
 * - Explicit inherit (display "(inherit)")
 * - Explicit value
 */
function formatCurrentValueEditable(
  parsed: ParsedConfigValues,
  editable: EditableAgentConfig,
  field: "model" | "thinking" | "maxTurns",
): string {
  const editableKey = field === "maxTurns" ? "maxTurns" : field;

  if (editableKey in editable) {
    const val = editable[editableKey as keyof EditableAgentConfig];
    if (val === undefined) {
      return "(inherit)";
    }
    if (field === "model" || field === "thinking") {
      return val as string;
    }
    return `${val}`;
  }

  // Untouched — use parsed value
  return formatCurrentValue(parsed, field);
}

// ---------------------------------------------------------------------------
// Model editing
// ---------------------------------------------------------------------------

/**
 * Edit the model field using the searchable model selector.
 *
 * Delegates to `ui.selectModel()` which presents a searchable, filterable list
 * of all known models with scoped (enabled) models shown first. The selector
 * also offers "Inherit" and "Manual entry" actions.
 *
 * Returns:
 * - `INHERIT` sentinel when the user chooses to inherit the default
 * - A model full ID string when the user selects or manually enters a model
 * - `undefined` when the user cancels at any point
 */
async function editModel(
  ui: AgentConfigUi,
  currentModel: string | undefined,
  modelChoices: { enabled: ModelDescriptor[]; all: ModelDescriptor[] },
): Promise<string | undefined> {
  const selection = await ui.selectModel({
    enabled: modelChoices.enabled,
    all: modelChoices.all,
    current: currentModel,
  });

  if (selection === undefined) return undefined; // cancelled

  switch (selection.kind) {
    case "inherit":
      return INHERIT;
    case "model":
      return selection.value;
    case "manual":
      return await promptManualModel(ui);
  }
}

/**
 * Prompt for a manual model value with unlimited retry via confirm loop.
 * Returns the validated value, undefined on cancel.
 */
async function promptManualModel(
  ui: AgentConfigUi,
): Promise<string | undefined> {
  const raw = await ui.input("Enter model value", "provider/model-id or model name");
  if (raw === undefined) return undefined;

  try {
    return validateManualModel(raw);
  } catch (e) {
    ui.notify(`Invalid model: ${(e as Error).message}`, "error");
    const retry = await ui.confirm("Invalid input", "Would you like to try again?");
    if (retry) return await promptManualModel(ui);
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Thinking editing
// ---------------------------------------------------------------------------

async function editThinking(
  ui: AgentConfigUi,
  currentThinking: string | undefined,
): Promise<string | undefined> {
  const entries: Array<{ label: string; value: string }> = [
    { label: "Inherit (use default)", value: INHERIT },
  ];

  for (const level of THINKING_LEVELS) {
    entries.push({ label: level, value: level });
  }

  const menu = makeLabeledOptions(entries);
  const choice = await ui.select("Edit thinking level", menu.options);
  if (choice === undefined) return undefined;

  const value = menu.lookup.get(choice);
  if (value === INHERIT) return INHERIT;
  return value;
}

// ---------------------------------------------------------------------------
// Max turns editing
// ---------------------------------------------------------------------------

async function editMaxTurns(
  ui: AgentConfigUi,
  currentMaxTurns: number | undefined,
): Promise<string | undefined> {
  const entries: Array<{ label: string; value: string }> = [
    { label: "Inherit (use default)", value: INHERIT },
    { label: "Enter value...", value: MANUAL },
  ];

  const menu = makeLabeledOptions(entries);
  const choice = await ui.select("Edit max turns", menu.options);
  if (choice === undefined) return undefined;

  const action = menu.lookup.get(choice);
  if (action === INHERIT) return INHERIT;

  if (action === MANUAL) {
    return await promptMaxTurnsValue(ui);
  }

  return undefined;
}

async function promptMaxTurnsValue(
  ui: AgentConfigUi,
): Promise<string | undefined> {
  const raw = await ui.input("Enter max turns", "positive integer");
  if (raw === undefined) return undefined;

  const trimmed = raw.trim();
  if (trimmed === "") {
    ui.notify("Max turns must not be empty", "error");
    // Retry or cancel
    const retry = await ui.confirm("Invalid input", "Would you like to try again?");
    if (retry) return await promptMaxTurnsValue(ui);
    return undefined;
  }

  const num = Number(trimmed);
  if (!Number.isFinite(num) || !Number.isInteger(num) || num <= 0) {
    ui.notify(`Invalid max turns: "${trimmed}". Must be a positive integer.`, "error");
    const retry = await ui.confirm("Invalid input", "Would you like to try again?");
    if (retry) return await promptMaxTurnsValue(ui);
    return undefined;
  }

  return trimmed; // Return the string representation for the config value
}

// ---------------------------------------------------------------------------
// Build before/after summary
// ---------------------------------------------------------------------------

function buildBeforeAfterSummary(
  before: ParsedConfigValues,
  after: EditableAgentConfig,
  targetPath: string,
): string {
  const lines: string[] = [];

  lines.push(`Target: ${targetPath}`);
  lines.push("");

  // Model
  lines.push(formatFieldSummary(before, after, "model", "model"));

  // Thinking
  lines.push(formatFieldSummary(before, after, "thinking", "thinking"));

  // Max turns
  lines.push(formatFieldSummary(before, after, "maxTurns", "maxTurns"));

  return lines.join("\n");
}

function formatFieldSummary(
  before: ParsedConfigValues,
  after: EditableAgentConfig,
  field: "model" | "thinking" | "maxTurns",
  editableKey: "model" | "thinking" | "maxTurns",
): string {
  const beforeDisplay = field === "maxTurns"
    ? (before.maxTurns !== undefined ? `${before.maxTurns}` : "(not set)")
    : ((before[field] as string | undefined) ?? "(not set)");

  if (!(editableKey in after)) {
    // Untouched — no change
    return `${capitalize(field)}: ${beforeDisplay} → (unchanged)`;
  }

  const afterVal = after[editableKey];
  if (afterVal === undefined) {
    // Explicit inherit
    return `${capitalize(field)}: ${beforeDisplay} → (inherit)`;
  }

  // Explicit value
  const afterDisplay = field === "maxTurns" ? `${afterVal}` : afterVal as string;
  return `${capitalize(field)}: ${beforeDisplay} → ${afterDisplay}`;
}

function capitalize(s: string): string {
  if (s === "maxTurns") return "Max turns";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Main workflow
// ---------------------------------------------------------------------------

export async function runAgentConfigWorkflow(
  requestedAgent: string | undefined,
  deps: AgentConfigWorkflowDependencies,
): Promise<AgentConfigWorkflowResult> {
  const { ui, cwd, configDir, allModels, enabledModelPatterns, builtinSources } = deps;

  // 1. Resolve directories and discover agents
  const dirs = resolveAgentDirectories(cwd, configDir);
  const fileSources = await discoverFileAgents(dirs);
  const allSources = [...fileSources, ...builtinSources];
  const discovered = resolveAgentPrecedence(allSources);

  if (discovered.length === 0) {
    ui.notify("No agents found. Eject a built-in agent or create a custom agent first.", "warning");
    return { saved: false, reloadRequired: false };
  }

  // 2. Select or validate agent
  let selectedAgent: DiscoveredAgent | undefined;

  if (requestedAgent !== undefined) {
    // Validate agent name before lookup (Gap 4)
    try {
      validateAgentName(requestedAgent);
    } catch (e) {
      ui.notify(`Invalid agent name "${requestedAgent}": ${(e as Error).message}`, "error");
      return { saved: false, reloadRequired: false };
    }
    const found = discovered.find((d) => d.name === requestedAgent);
    if (!found) {
      ui.notify(
        `Agent "${requestedAgent}" not found. Available agents: ${discovered.map((d) => d.name).join(", ")}`,
        "error",
      );
      return { saved: false, reloadRequired: false };
    }
    selectedAgent = found;
  } else {
    // Interactive selection with source labels
    const agentLabels = discovered.map((d) => {
      const kindLabel = sourceKindLabel(d.effective.kind);
      let label: string;
      if (d.sources.length > 1) {
        // Deduplicate shadowed source kinds
        const seenKinds = new Set<string>();
        const shadowedKinds: string[] = [];
        for (const s of d.sources.slice(1)) {
          const sk = sourceKindLabel(s.kind);
          if (!seenKinds.has(sk)) {
            seenKinds.add(sk);
            shadowedKinds.push(sk);
          }
        }
        const shadowed = shadowedKinds.join(", ");
        label = `${d.name} (${kindLabel} — shadows ${shadowed})`;
      } else {
        label = `${d.name} (${kindLabel})`;
      }
      return { label, value: d.name };
    });

    const menu = makeLabeledOptions(agentLabels);
    const choice = await ui.select("Select agent to configure", menu.options);
    if (choice === undefined) {
      return { saved: false, reloadRequired: false };
    }

    const name = menu.lookup.get(choice);
    if (name === undefined) {
      return { saved: false, reloadRequired: false };
    }

    selectedAgent = discovered.find((d) => d.name === name);
    if (!selectedAgent) {
      return { saved: false, reloadRequired: false };
    }
  }

  // 3. Select scope
  const scopeEntries: Array<{ label: string; value: string }> = [
    { label: "Project (.pi/agents)", value: "project" },
    { label: "Global", value: "global" },
  ];

  const scopeMenu = makeLabeledOptions(scopeEntries);
  const scopeChoice = await ui.select(
    `Select scope for ${selectedAgent.name}`,
    scopeMenu.options,
  );
  if (scopeChoice === undefined) {
    return { saved: false, reloadRequired: false };
  }

  const scope = scopeMenu.lookup.get(scopeChoice) as AgentScope;
  if (!scope) {
    return { saved: false, reloadRequired: false };
  }

  // 3a. Explain shadow warnings
  if (scope === "project") {
    const hasShadowed = selectedAgent.sources.some(
      (s) => s.kind === "global" || s.kind === "builtin",
    );
    if (hasShadowed) {
      const confirmed = await ui.confirm(
        "Shadow warning",
        "A project-level definition will override any global or built-in definition for this agent.",
      );
      if (!confirmed) {
        return { saved: false, reloadRequired: false };
      }
    }
  } else {
    // scope === "global"
    const hasProjectSource = selectedAgent.sources.some(
      (s) => s.kind === "project-pi" || s.kind === "project-agents",
    );
    if (hasProjectSource) {
      const confirmed = await ui.confirm(
        "Shadow warning",
        "A project-level definition already exists for this agent and will take precedence over this global edit. The global edit will only take effect when no project-level definition exists.",
      );
      if (!confirmed) {
        return { saved: false, reloadRequired: false };
      }
    }
  }

  // 4. Get target base content
  const targetPath = targetAgentPath(selectedAgent.name, scope, dirs);

  // Find existing source at the chosen scope
  const scopeKind: AgentSourceKind = scope === "project" ? "project-pi" : "global";
  const existingAtScope = selectedAgent.sources.find((s) => s.kind === scopeKind);

  let baseContent: string;
  let sourceLabel: string;

  if (existingAtScope && existingAtScope.content !== undefined) {
    baseContent = existingAtScope.content;
    sourceLabel = sourceKindLabel(existingAtScope.kind);
  } else {
    // Use effective content
    if (selectedAgent.effective.content !== undefined) {
      baseContent = selectedAgent.effective.content;
      sourceLabel = sourceKindLabel(selectedAgent.effective.kind);
    } else {
      ui.notify(
        `Cannot configure "${selectedAgent.name}": no content available for the effective source. Eject the agent first through /agents.`,
        "error",
      );
      return { saved: false, reloadRequired: false };
    }
  }

  // 5. Validate baseContent is parseable (Gap 3)
  try {
    parseAgentDocument(baseContent);
  } catch (e) {
    ui.notify(
      `Cannot configure "${selectedAgent.name}": the existing configuration file is malformed. ` +
        `Fix the file manually or eject the agent again through /agents. ` +
        `Error: ${(e as Error).message}`,
      "error",
    );
    return { saved: false, reloadRequired: false };
  }

  // Parse current values
  const parsed = parseCurrentConfig(baseContent);

  // 6. Build model choices
  const modelChoices = buildModelChoices(allModels, enabledModelPatterns);

  // 7. Dashboard loop
  const editable: EditableAgentConfig = {};

  while (true) {
    const dashboard = formatDashboard(
      parsed,
      editable,
      `${sourceLabel} → ${sourceKindLabel(scopeKind)}`,
    );

    const dashboardEntries: Array<{ label: string; value: string }> = [
      { label: "Edit model", value: "model" },
      { label: "Edit thinking", value: "thinking" },
      { label: "Edit max turns", value: "maxTurns" },
      { label: "Save", value: "save" },
      { label: "Cancel", value: "cancel" },
    ];

    const dashMenu = makeLabeledOptions(dashboardEntries);
    const dashChoice = await ui.select(dashboard, dashMenu.options);
    if (dashChoice === undefined) {
      return { saved: false, reloadRequired: false };
    }

    const dashAction = dashMenu.lookup.get(dashChoice);
    if (dashAction === undefined) {
      return { saved: false, reloadRequired: false };
    }

    if (dashAction === "cancel") {
      return { saved: false, reloadRequired: false };
    }

    if (dashAction === "save") {
      break;
    }

    if (dashAction === "model") {
      // Compute effective current model for the selector:
      // - If editable.model property exists (set or inherit), use it
      // - Otherwise fall back to the parsed value from the file
      const currentModel: string | undefined =
        "model" in editable ? editable.model : parsed.model;
      const result = await editModel(ui, currentModel, modelChoices);
      if (result === undefined) continue; // cancelled at model level
      if (result === INHERIT) {
        editable.model = undefined;
      } else {
        editable.model = result;
      }
      continue;
    }

    if (dashAction === "thinking") {
      const result = await editThinking(ui, parsed.thinking);
      if (result === undefined) continue;
      if (result === INHERIT) {
        editable.thinking = undefined;
      } else {
        editable.thinking = result as ThinkingLevel;
      }
      continue;
    }

    if (dashAction === "maxTurns") {
      const result = await editMaxTurns(ui, parsed.maxTurns);
      if (result === undefined) continue;
      if (result === INHERIT) {
        editable.maxTurns = undefined;
      } else {
        const num = Number(result);
        if (Number.isFinite(num) && Number.isInteger(num) && num > 0) {
          editable.maxTurns = num;
        } else {
          // Should not happen if promptMaxTurnsValue validated correctly
          continue;
        }
      }
      continue;
    }
  }

  // 8. Build the final config for saving (only include touched fields)
  const finalConfig: EditableAgentConfig = {};
  if ("model" in editable) finalConfig.model = editable.model;
  if ("thinking" in editable) finalConfig.thinking = editable.thinking;
  if ("maxTurns" in editable) finalConfig.maxTurns = editable.maxTurns;

  // Compute effective display values for the summary (Gap 2)
  const effectiveForSummary: EditableAgentConfig = {};
  // Only include fields that were explicitly touched
  if ("model" in editable) effectiveForSummary.model = editable.model;
  if ("thinking" in editable) effectiveForSummary.thinking = editable.thinking;
  if ("maxTurns" in editable) effectiveForSummary.maxTurns = editable.maxTurns;

  // If nothing changed, still confirm
  const summary = buildBeforeAfterSummary(parsed, effectiveForSummary, targetPath);
  const confirmed = await ui.confirm("Save changes?", summary);
  if (!confirmed) {
    return { saved: false, reloadRequired: false };
  }

  // 9. Atomic save
  const newContent = updateAgentDocument(baseContent, finalConfig);

  try {
    const saveResult = await saveAgentDocument(targetPath, newContent);
    const msg = saveResult.backupPath
      ? `Saved to ${saveResult.path} (backup at ${saveResult.backupPath})`
      : `Saved to ${saveResult.path}`;
    ui.notify(msg, "info");
    return { saved: true, reloadRequired: true, path: saveResult.path };
  } catch (e) {
    ui.notify(`Failed to save: ${(e as Error).message}`, "error");
    return { saved: false, reloadRequired: false };
  }
}