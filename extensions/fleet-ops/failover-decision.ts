/**
 * Pure decision logic for provider-error failover.
 *
 * The extension observes `after_provider_response` events during an agent run,
 * accumulating provider errors. When the run settles (pi has exhausted its own
 * retries), it asks decideFailover() what to do. No I/O, no pi API here.
 */

import type { FleetRole, OnProviderError, RoleModels } from "./failover-config.js";

export interface ProviderErrorObservation {
	status: number;
	/** seconds parsed from a Retry-After header, if present */
	retryAfterSeconds?: number;
}

export type FailoverAction =
	| { kind: "none" }
	| { kind: "offer-switch"; role: FleetRole; from: string; to: string; retryAfterSeconds: number }
	| { kind: "auto-switch"; role: FleetRole; from: string; to: string }
	| { kind: "suggest-retry"; role: FleetRole; from: string; retryAfterSeconds: number; reason: string };

export interface DecideInput {
	role: FleetRole | undefined;
	roleModels: RoleModels | undefined;
	currentModelRef: string; // "provider/id" of the model that just failed
	errors: ProviderErrorObservation[];
	policy: OnProviderError;
}

/** Count errors whose status is in the switchable set. */
export function countSwitchableErrors(errors: ProviderErrorObservation[], statusCodes: number[]): number {
	return errors.filter((e) => statusCodes.includes(e.status)).length;
}

/** Largest Retry-After seen among matching errors, else the policy default. */
export function effectiveRetryAfter(
	errors: ProviderErrorObservation[],
	statusCodes: number[],
	fallbackSeconds: number,
): number {
	const matching = errors.filter((e) => statusCodes.includes(e.status));
	const maxHeader = matching.reduce((m, e) => Math.max(m, e.retryAfterSeconds ?? 0), 0);
	return maxHeader > 0 ? maxHeader : fallbackSeconds;
}

export function decideFailover(input: DecideInput): FailoverAction {
	const { role, roleModels, currentModelRef, errors, policy } = input;

	const switchable = countSwitchableErrors(errors, policy.statusCodes);
	if (switchable < policy.minErrorsToOffer) return { kind: "none" };

	// No role / no config → we can still suggest a timed retry, but can't switch.
	if (!role || !roleModels) {
		return {
			kind: "suggest-retry",
			role: (role ?? "worker") as FleetRole,
			from: currentModelRef,
			retryAfterSeconds: effectiveRetryAfter(errors, policy.statusCodes, policy.retryAfterSeconds),
			reason: "No fleet role/model config found — cannot pick a backup. Retry the primary or configure fleet-models.json.",
		};
	}

	// No backup defined for this role → timed retry is the only automated option.
	if (!roleModels.backup || roleModels.backup.trim() === "") {
		return {
			kind: "suggest-retry",
			role,
			from: currentModelRef,
			retryAfterSeconds: effectiveRetryAfter(errors, policy.statusCodes, policy.retryAfterSeconds),
			reason: `No backup configured for role "${role}". Retry the primary after the cooldown.`,
		};
	}

	// Already on backup? Don't ping-pong; suggest a timed retry instead.
	if (currentModelRef === roleModels.backup) {
		return {
			kind: "suggest-retry",
			role,
			from: currentModelRef,
			retryAfterSeconds: effectiveRetryAfter(errors, policy.statusCodes, policy.retryAfterSeconds),
			reason: `Backup model for role "${role}" is also erroring. Retry after the cooldown or escalate to the master.`,
		};
	}

	if (policy.autoSwitch) {
		return { kind: "auto-switch", role, from: currentModelRef, to: roleModels.backup };
	}
	return {
		kind: "offer-switch",
		role,
		from: currentModelRef,
		to: roleModels.backup,
		retryAfterSeconds: effectiveRetryAfter(errors, policy.statusCodes, policy.retryAfterSeconds),
	};
}

/** Parse a Retry-After header value (delta-seconds only; HTTP-date is ignored). */
export function parseRetryAfter(headers: Record<string, string>): number | undefined {
	const raw = headers["retry-after"] ?? headers["Retry-After"];
	if (!raw) return undefined;
	const n = Number.parseInt(raw.trim(), 10);
	return Number.isFinite(n) && n >= 0 ? n : undefined;
}
