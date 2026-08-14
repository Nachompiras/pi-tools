export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type AgentScope = "project" | "global";

export type AgentSourceKind = "project-pi" | "project-agents" | "global" | "builtin";

export interface ModelDescriptor {
  provider: string;
  id: string;
  name?: string;
}

export interface ModelChoices {
  enabled: ModelDescriptor[];
  all: ModelDescriptor[];
}

export interface EditableAgentConfig {
  model?: string;
  thinking?: ThinkingLevel;
  maxTurns?: number;
}

export interface AgentDocument {
  frontmatter: Record<string, unknown>;
  body: string;
  hadFrontmatter: boolean;
}

export interface AgentSource {
  name: string;
  kind: AgentSourceKind;
  path?: string;
  content?: string;
}

export interface BuiltinLoadResult {
  sources: AgentSource[];
  warning?: string;
}

export interface DiscoveredAgent {
  name: string;
  effective: AgentSource;
  sources: AgentSource[];
}

export interface AgentDirectories {
  projectPi: string;
  projectAgents: string;
  global: string;
}

export interface SaveAgentResult {
  path: string;
  backupPath?: string;
}

export interface SaveAgentOptions {
  now?: Date;
}

export const THINKING_LEVELS: readonly ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export function isValidThinkingLevel(value: string): value is ThinkingLevel {
  return (THINKING_LEVELS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Workflow types (Task 7)
// ---------------------------------------------------------------------------

export interface AgentConfigUi {
  select(title: string, options: string[]): Promise<string | undefined>;
  selectModel(options: ModelSelectorOptions): Promise<ModelSelection | undefined>;
  input(title: string, placeholder?: string): Promise<string | undefined>;
  confirm(title: string, message: string): Promise<boolean>;
  notify(message: string, level: "info" | "warning" | "error"): void;
}

export interface AgentConfigWorkflowDependencies {
  ui: AgentConfigUi;
  cwd: string;
  configDir: string;
  allModels: ModelDescriptor[];
  enabledModelPatterns?: string[];
  builtinSources: AgentSource[];
}

export interface AgentConfigWorkflowResult {
  saved: boolean;
  reloadRequired: boolean;
  path?: string;
}

export interface ParsedConfigValues {
  model?: string;
  thinking?: string;
  maxTurns?: number;
  modelMalformed: boolean;
  thinkingMalformed: boolean;
  maxTurnsMalformed: boolean;
}

// ---------------------------------------------------------------------------
// Model selector state types (Task 1)
// ---------------------------------------------------------------------------

export type ModelSelection =
  | { kind: "inherit" }
  | { kind: "manual" }
  | { kind: "model"; value: string };

export interface ModelSelectorOptions {
  enabled: ModelDescriptor[];
  all: ModelDescriptor[];
  current?: string;
}

export type ModelSelectorItem =
  | { kind: "inherit"; key: "inherit" }
  | { kind: "manual"; key: "manual" }
  | { kind: "model"; key: string; model: ModelDescriptor; enabled: boolean };
