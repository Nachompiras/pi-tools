import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const CONFIG_PATH = join(process.env.HOME || "", ".pi/agent/subagent-models.json");

export type Role = "cheap" | "implementer" | "standard" | "capable";
export const ROLES: Role[] = ["cheap", "implementer", "standard", "capable"];

export interface ModelConfig {
  description: string;
  models: Record<Role, { model: string; description: string }>;
}

export const DEFAULT_CONFIG: ModelConfig = {
  description: "Model selection for subagent-driven-development skill",
  models: {
    cheap: {
      model: "openrouter/minimax/minimax-m2.7",
      description: "Mechanical implementation tasks, isolated functions, clear specs, 1-2 files",
    },
    implementer: {
      model: "openrouter/minimax/minimax-m2.7",
      description: "Implementation tasks, code writing, and mechanical coding work",
    },
    standard: {
      model: "openrouter/anthropic/claude-sonnet-4.6",
      description: "Integration tasks, multi-file coordination, pattern matching, debugging",
    },
    capable: {
      model: "openrouter/anthropic/claude-opus-4.6",
      description: "Architecture, design, review tasks, broad codebase understanding",
    },
  },
};

export function readSubagentModelConfig(): ModelConfig {
  if (!existsSync(CONFIG_PATH)) {
    const dir = dirname(CONFIG_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
    return { ...DEFAULT_CONFIG };
  }

  const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as Partial<ModelConfig> & {
    models?: Partial<ModelConfig["models"]>;
  };

  // Build merged config: each role falls back to its default if missing/incomplete.
  // For implementer specifically, also seed from cheap.model when first added so
  // users who had no implementer key get a sensible starting point.
  const cheapModel = config.models?.cheap?.model;
  const merged: ModelConfig = {
    description: config.description || DEFAULT_CONFIG.description,
    models: {
      cheap: config.models?.cheap ?? DEFAULT_CONFIG.models.cheap,
      implementer: config.models?.implementer ?? {
        model: cheapModel ?? DEFAULT_CONFIG.models.implementer.model,
        description: DEFAULT_CONFIG.models.implementer.description,
      },
      standard: config.models?.standard ?? DEFAULT_CONFIG.models.standard,
      capable: config.models?.capable ?? DEFAULT_CONFIG.models.capable,
    },
  };

  // Persist whenever any role was missing so the file stays fully normalised.
  const needsWrite = ROLES.some((role) => !config.models?.[role]);
  if (needsWrite) {
    writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
  }

  return merged;
}

export function writeSubagentModelConfig(config: ModelConfig): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}
