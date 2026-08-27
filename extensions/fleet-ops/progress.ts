/**
 * Pure progress-summary builder for /como-vamos.
 *
 * Turns parsed coordination files into a plain-text report. No I/O, no colour
 * codes here — the extension adds theme colours when it prints. Kept pure so the
 * whole "how are we doing" computation is unit-testable.
 */

import {
	AGENT_STATES,
	type PodBoard,
	TASK_STATUSES,
	type TestRegistryRow,
} from "./parse.js";

export interface WaveSnapshot {
	waveId: string;
	pods: PodBoard[];
	expectedPods: string[];
	handoffPods: string[]; // pods that have a pod-<p>-handoff.md present
	testRegistry: TestRegistryRow[];
	staleBoards: string[]; // pod names whose board is stale
}

export interface ProgressReport {
	lines: string[];
	/** true when something needs the master's attention (missing pod, blocked, stale, failed test) */
	needsAttention: boolean;
	attention: string[];
}

function bar(done: number, total: number, width = 20): string {
	if (total <= 0) return "─".repeat(width) + " n/a";
	const filled = Math.round((done / total) * width);
	return "█".repeat(filled) + "░".repeat(width - filled) + ` ${done}/${total}`;
}

function countStates(board: PodBoard): Record<string, number> {
	const c: Record<string, number> = {};
	for (const s of AGENT_STATES) c[s] = 0;
	for (const a of board.agents) c[a.state] = (c[a.state] ?? 0) + 1;
	return c;
}

function countTasks(board: PodBoard): Record<string, number> {
	const c: Record<string, number> = {};
	for (const s of TASK_STATUSES) c[s] = 0;
	for (const t of board.tasks) c[t.status] = (c[t.status] ?? 0) + 1;
	return c;
}

export function buildProgressReport(snap: WaveSnapshot): ProgressReport {
	const lines: string[] = [];
	const attention: string[] = [];

	lines.push(`Wave ${snap.waveId} — ¿cómo vamos?`);
	lines.push("");

	// --- Pod integration readiness (silent-failure guard) ---
	if (snap.expectedPods.length > 0) {
		const missing = snap.expectedPods.filter((p) => !snap.handoffPods.includes(p));
		lines.push(
			`Pods: ${snap.handoffPods.length}/${snap.expectedPods.length} handoffs received` +
				(missing.length ? `  ⚠ missing: ${missing.join(", ")}` : "  ✓"),
		);
		if (missing.length) attention.push(`Missing pod handoff(s): ${missing.join(", ")} — do NOT integrate partial.`);
	} else {
		lines.push("Pods: (no expected pods declared — run: fleet.sh expect <wave> <pod>...)");
	}
	lines.push("");

	// --- Per-pod progress ---
	for (const board of snap.pods) {
		const tasks = countTasks(board);
		const doneCount = tasks.DONE ?? 0;
		const totalTasks = board.tasks.length;
		const stale = snap.staleBoards.includes(board.pod);
		const hasHandoff = snap.handoffPods.includes(board.pod);

		lines.push(
			`■ Pod ${board.pod}${board.header.ARCHITECT ? ` (${board.header.ARCHITECT})` : ""}` +
				(hasHandoff ? "  ✓ handoff" : "") +
				(stale ? "  ⚠ STALE board" : ""),
		);
		lines.push(`   tasks  ${bar(doneCount, totalTasks)}`);

		// what's actually being built right now: in-progress tasks + who owns them
		const inFlight = board.tasks.filter((t) => t.status === "IN_PROGRESS" || t.status === "REVIEW" || t.status === "WAITING_TEST");
		if (inFlight.length > 0) {
			for (const t of inFlight) {
				const who = t.owner && t.owner !== "-" ? t.owner : "(unassigned)";
				const scope = t.scope && t.scope !== "-" ? t.scope : "?";
				const tag = t.status === "IN_PROGRESS" ? "▶" : t.status === "REVIEW" ? "👁" : "⏱";
				lines.push(`   ${tag} ${t.taskId} ${scope}  — ${who}${t.status !== "IN_PROGRESS" ? ` [${t.status}]` : ""}`);
			}
		}
		// blocked work is part of "what's happening" too
		for (const t of board.tasks.filter((t) => t.status === "BLOCKED")) {
			const who = t.owner && t.owner !== "-" ? t.owner : "(unassigned)";
			const dep = t.dependencies && t.dependencies !== "-" ? `  waiting on ${t.dependencies}` : "";
			const scope = t.scope && t.scope !== "-" ? t.scope : "?";
			lines.push(`   ⛔ ${t.taskId} ${scope}  — ${who} BLOCKED${dep}`);
		}

		// task status breakdown (only non-zero)
		const taskParts = TASK_STATUSES.filter((s) => (tasks[s] ?? 0) > 0).map((s) => `${s}:${tasks[s]}`);
		if (taskParts.length) lines.push(`          ${taskParts.join("  ")}`);

		// agent states (only non-zero)
		const states = countStates(board);
		const agentParts = AGENT_STATES.filter((s) => (states[s] ?? 0) > 0).map((s) => `${s}:${states[s]}`);
		if (agentParts.length) lines.push(`   agents ${agentParts.join("  ")}`);

		// attention: blocked / idle-with-work / stale
		const blocked = board.agents.filter((a) => a.state === "BLOCKED");
		for (const a of blocked) attention.push(`Pod ${board.pod}: ${a.agent} is BLOCKED (task ${a.currentTask || "?"}).`);
		const idle = board.agents.filter((a) => a.state === "IDLE");
		const readyTasks = board.tasks.filter((t) => t.status === "READY" || t.status === "BACKLOG");
		if (idle.length > 0 && readyTasks.length > 0) {
			attention.push(
				`Pod ${board.pod}: ${idle.length} idle agent(s) with ${readyTasks.length} unstarted task(s) — dispatch more work.`,
			);
		}
		if (stale) attention.push(`Pod ${board.pod}: board is STALE — refresh via its architect.`);
		lines.push("");
	}

	// --- Test Pod evidence ---
	if (snap.testRegistry.length > 0) {
		const passed = snap.testRegistry.filter((r) => r.status === "PASSED").length;
		const failed = snap.testRegistry.filter((r) => r.status === "FAILED");
		const running = snap.testRegistry.filter((r) => r.status === "RUNNING" || r.status === "QUEUED").length;
		lines.push(
			`Test Pod: ${snap.testRegistry.length} execution(s)  PASSED:${passed}  FAILED:${failed.length}  IN-FLIGHT:${running}`,
		);
		for (const f of failed) {
			attention.push(`Test FAILED: ${f.command} @ ${f.targetSha.slice(0, 8)} (${f.evidence || "no evidence path"}).`);
		}
	} else {
		lines.push("Test Pod: no recorded executions yet.");
	}

	if (attention.length > 0) {
		lines.push("");
		lines.push("⚠ Needs attention:");
		for (const a of attention) lines.push(`   • ${a}`);
	}

	return { lines, needsAttention: attention.length > 0, attention };
}
