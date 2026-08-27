/**
 * Role → model configuration for fleet failover. Pure: parse + validate + resolve.
 *
 * Config file (first found wins):
 *   <cwd>/.pi/fleet-models.json
 *   ~/.pi/fleet-models.json
 *
 * A session's role comes from the --fleet-role flag or the FLEET_ROLE env var.
 * On a persistent provider error (e.g. 429) for the session's primary model,
 * the extension offers to switch that session to the role's `backup`.
 */

export type FleetRole = "master" | "supervisor" | "architect" | "worker" | "reviewer" | "test-worker";

export interface RoleModels {
	primary: string; // "provider/modelId" (id may itself contain slashes, e.g. openrouter/deepseek/...)
	backup?: string;
	thinking?: string; // thinking level to apply on this role's model
}

export interface OnProviderError {
	retryAfterSeconds: number;
	autoSwitch: boolean; // false = ask the user; true = switch to backup automatically
	statusCodes: number[]; // provider HTTP statuses that count as a switchable error
	minErrorsToOffer: number; // how many matching errors in one settled run before offering
}

export interface FleetModelsConfig {
	roles: Partial<Record<FleetRole, RoleModels>>;
	onProviderError: OnProviderError;
	/** Supervisor watchdog interval in seconds. 0 disables the timer. Default 60. */
	watchdogSeconds: number;
}

export interface ModelRef {
	provider: string;
	id: string;
}

export const DEFAULT_ON_PROVIDER_ERROR: OnProviderError = {
	retryAfterSeconds: 60,
	autoSwitch: false,
	statusCodes: [429, 503],
	minErrorsToOffer: 2,
};

/**
 * Shipped defaults. Model IDs match the pi catalogue naming used elsewhere in
 * this repo; adjust to your own `pi --list-models` identifiers as needed.
 * Backups reflect the team's stated choices (worker→glm-5.3-flash,
 * reviewer→opus-4.8, supervisor→minimax-v2.5-pro).
 */
export const DEFAULT_CONFIG: FleetModelsConfig = {
	roles: {
		master: { primary: "openai-codex/gpt-5.6-sol", thinking: "xhigh" },
		supervisor: { primary: "openrouter/minimax/minimax-v2.5-pro", backup: "openrouter/z-ai/glm-5.3-flash" },
		architect: {
			primary: "openai-codex/gpt-5.6-sol",
			backup: "openrouter/qwen/qwen3.7-plus",
			thinking: "high",
		},
		worker: {
			primary: "openrouter/deepseek/deepseek-v4-flash-0731",
			backup: "openrouter/z-ai/glm-5.3-flash",
			thinking: "high",
		},
		reviewer: {
			primary: "openai-codex/gpt-5.6-sol",
			backup: "anthropic/claude-opus-4-8",
			thinking: "high",
		},
		"test-worker": {
			primary: "openrouter/deepseek/deepseek-v4-flash-0731",
			backup: "openrouter/z-ai/glm-5.3-flash",
		},
	},
	onProviderError: DEFAULT_ON_PROVIDER_ERROR,
	watchdogSeconds: 60,
};

const VALID_ROLES: readonly FleetRole[] = [
	"master",
	"supervisor",
	"architect",
	"worker",
	"reviewer",
	"test-worker",
];

export function isFleetRole(x: unknown): x is FleetRole {
	return typeof x === "string" && (VALID_ROLES as readonly string[]).includes(x);
}

/** Split "provider/modelId" on the FIRST slash; the id keeps any remaining slashes. */
export function parseModelRef(ref: string): ModelRef | null {
	const trimmed = ref.trim();
	const slash = trimmed.indexOf("/");
	if (slash <= 0 || slash === trimmed.length - 1) return null;
	return { provider: trimmed.slice(0, slash), id: trimmed.slice(slash + 1) };
}

/**
 * Merge a parsed user config over the shipped defaults. Unknown roles and
 * malformed fields are dropped (defensively) rather than throwing, so a typo in
 * one role never disables failover for the rest.
 */
export function mergeConfig(raw: unknown): FleetModelsConfig {
	const out: FleetModelsConfig = {
		roles: { ...DEFAULT_CONFIG.roles },
		onProviderError: { ...DEFAULT_ON_PROVIDER_ERROR },
		watchdogSeconds: DEFAULT_CONFIG.watchdogSeconds,
	};
	if (!raw || typeof raw !== "object") return out;
	const obj = raw as Record<string, unknown>;

	if (typeof obj.watchdogSeconds === "number" && obj.watchdogSeconds >= 0) {
		out.watchdogSeconds = obj.watchdogSeconds;
	}

	if (obj.roles && typeof obj.roles === "object") {
		for (const [role, val] of Object.entries(obj.roles as Record<string, unknown>)) {
			if (!isFleetRole(role) || !val || typeof val !== "object") continue;
			const v = val as Record<string, unknown>;
			if (typeof v.primary !== "string") continue;
			out.roles[role] = {
				primary: v.primary,
				...(typeof v.backup === "string" ? { backup: v.backup } : {}),
				...(typeof v.thinking === "string" ? { thinking: v.thinking } : {}),
			};
		}
	}

	if (obj.onProviderError && typeof obj.onProviderError === "object") {
		const e = obj.onProviderError as Record<string, unknown>;
		if (typeof e.retryAfterSeconds === "number" && e.retryAfterSeconds >= 0) {
			out.onProviderError.retryAfterSeconds = e.retryAfterSeconds;
		}
		if (typeof e.autoSwitch === "boolean") out.onProviderError.autoSwitch = e.autoSwitch;
		if (Array.isArray(e.statusCodes) && e.statusCodes.every((c) => typeof c === "number")) {
			out.onProviderError.statusCodes = e.statusCodes as number[];
		}
		if (typeof e.minErrorsToOffer === "number" && e.minErrorsToOffer >= 1) {
			out.onProviderError.minErrorsToOffer = e.minErrorsToOffer;
		}
	}
	return out;
}

export function resolveRoleModels(config: FleetModelsConfig, role: FleetRole | undefined): RoleModels | undefined {
	if (!role) return undefined;
	return config.roles[role];
}
