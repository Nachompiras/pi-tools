/**
 * Deterministic watchdog for the monitor session.
 *
 * The monitor's whole job is auditing overdue entries. The push side of the
 * protocol (architects notify on board change) can't catch a SILENTLY stalled
 * agent — it never pushes. So the monitor runs a mechanical clock: every
 * `watchdogSeconds`, scan every pod board and surface only entries whose
 * NEXT_CHECK_IN has passed. Nothing wakes the master; the reminder goes to the
 * monitor, which then audits via the owning architect (never the worker).
 *
 * Pure + side-effect-free so it can be unit tested. The extension supplies the
 * boards, `now`, and does the actual messaging.
 */

import type { PodBoard } from "./parse.js";

export interface OverdueEntry {
	pod: string;
	kind: "agent" | "task";
	id: string; // agent name or task id
	state: string; // agent state or task status
	nextCheckIn: string; // raw value from the board
	overdueSeconds: number; // how long past due
}

export interface WatchdogResult {
	overdue: OverdueEntry[];
	/** entries whose NEXT_CHECK_IN could not be parsed — worth surfacing, not crashing */
	unparseable: OverdueEntry[];
	scannedPods: number;
}

/** States that legitimately have no active check-in — never overdue. */
const INACTIVE_AGENT_STATES = new Set(["OFFLINE"]);
const TERMINAL_TASK_STATUSES = new Set(["DONE", "BACKLOG"]);

/**
 * Parse a NEXT_CHECK_IN value to an absolute epoch (ms).
 * Accepts:
 *   - ISO-8601 / any Date.parse-able absolute timestamp  -> that instant
 *   - "HH:MM" (today, in local time relative to `now`)   -> today at HH:MM
 * Returns null when the value is empty, a placeholder ("-", "+30m"), or
 * otherwise not an absolute time we can compare deterministically.
 */
export function parseCheckIn(raw: string, now: number): number | null {
	const v = raw.trim();
	if (!v || v === "-" || v === "?") return null;
	// relative placeholders like "+30m" are not absolute — cannot compare
	if (/^\+/.test(v)) return null;

	// absolute timestamp
	const abs = Date.parse(v);
	if (!Number.isNaN(abs)) return abs;

	// HH:MM -> today at that wall-clock time (local)
	const hm = v.match(/^([0-2]?\d):([0-5]\d)$/);
	if (hm) {
		const d = new Date(now);
		d.setHours(Number(hm[1]), Number(hm[2]), 0, 0);
		return d.getTime();
	}
	return null;
}

export function runWatchdog(boards: PodBoard[], now: number): WatchdogResult {
	const overdue: OverdueEntry[] = [];
	const unparseable: OverdueEntry[] = [];

	for (const board of boards) {
		for (const a of board.agents) {
			if (INACTIVE_AGENT_STATES.has(a.state)) continue;
			classify(board.pod, "agent", a.agent, a.state, a.nextCheckIn, now, overdue, unparseable);
		}
		for (const t of board.tasks) {
			if (TERMINAL_TASK_STATUSES.has(t.status)) continue;
			classify(board.pod, "task", t.taskId, t.status, t.nextCheckIn, now, overdue, unparseable);
		}
	}

	overdue.sort((x, y) => y.overdueSeconds - x.overdueSeconds);
	return { overdue, unparseable, scannedPods: boards.length };
}

function classify(
	pod: string,
	kind: "agent" | "task",
	id: string,
	state: string,
	rawCheckIn: string,
	now: number,
	overdue: OverdueEntry[],
	unparseable: OverdueEntry[],
): void {
	const v = rawCheckIn.trim();
	// An active entry with no check-in declared is itself a protocol gap worth flagging.
	if (!v || v === "-") {
		unparseable.push({ pod, kind, id, state, nextCheckIn: v || "(none)", overdueSeconds: 0 });
		return;
	}
	const due = parseCheckIn(v, now);
	if (due === null) {
		unparseable.push({ pod, kind, id, state, nextCheckIn: v, overdueSeconds: 0 });
		return;
	}
	if (now > due) {
		overdue.push({ pod, kind, id, state, nextCheckIn: v, overdueSeconds: Math.round((now - due) / 1000) });
	}
}

/** Stable dedup signature so the same overdue set isn't re-announced every tick. */
export function watchdogSignature(result: WatchdogResult): string {
	const key = (e: OverdueEntry) => `${e.pod}/${e.kind}/${e.id}/${e.state}`;
	const over = result.overdue.map(key).sort().join(",");
	const unp = result.unparseable.map(key).sort().join(",");
	return `O[${over}]U[${unp}]`;
}

/** Human-readable reminder body the monitor sees. Empty string when all fresh. */
export function formatWatchdogMessage(result: WatchdogResult): string {
	if (result.overdue.length === 0 && result.unparseable.length === 0) return "";
	const lines: string[] = [];
	lines.push(`⏱ Watchdog: ${result.overdue.length} overdue across ${result.scannedPods} pod(s). Audit via each pod's architect (never the worker).`);
	for (const e of result.overdue) {
		const mins = Math.floor(e.overdueSeconds / 60);
		const ago = mins >= 1 ? `${mins}m overdue` : `${e.overdueSeconds}s overdue`;
		lines.push(`  • ${e.pod} ${e.kind} ${e.id} [${e.state}] — NEXT_CHECK_IN ${e.nextCheckIn}, ${ago}`);
	}
	if (result.unparseable.length > 0) {
		lines.push(`  ${result.unparseable.length} active entr(y/ies) with no usable NEXT_CHECK_IN — set an absolute time:`);
		for (const e of result.unparseable) {
			lines.push(`  • ${e.pod} ${e.kind} ${e.id} [${e.state}] — check-in "${e.nextCheckIn}"`);
		}
	}
	return lines.join("\n");
}
