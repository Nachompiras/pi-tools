/**
 * Pure organigram + dependency-graph builder for /equipo.
 *
 * /como-vamos answers "how are we doing" (progress). /equipo answers
 * "who is who and how do they connect" (topology). Data sources:
 *   - pod kanbans        → pods, agents, per-task DEPENDENCIES
 *   - `herdr agent list` → live agent state (idle/working/blocked) when in Herdr
 *   - test-pod-kanban    → Test Pod header
 * No comando/archivo nuevo for edges: the kanban task table already has a
 * DEPENDENCIES column; we read it.
 */

import type { AgentRow, PodBoard } from "./parse.js";

export type FleetRoleGuess = "architect" | "worker" | "reviewer" | "monitor" | "test-worker" | "agent";

/** A live agent as reported by `herdr agent list` (only the fields we use). */
export interface LiveAgent {
	name: string;
	status: string; // idle | working | blocked | done | unknown
	paneId?: string;
}

export interface TeamInput {
	waveId: string;
	pods: PodBoard[];
	master?: string; // master agent name, if known (e.g. FLEET_MASTER env or herdr)
	monitor?: string; // monitor agent name, if known
	testArchitect?: string;
	testWorkers?: string[];
	maxTestWorkers?: string;
	liveAgents?: LiveAgent[]; // from herdr; empty on non-herdr runtimes
	contextOf?: (agent: string) => number | undefined; // agent → context percent, if known
}

/** Infer a role from an agent handle so the tree can icon/group it. */
export function guessRole(name: string): FleetRoleGuess {
	const n = name.toLowerCase();
	if (/(^|[_-])(arch|architect)([_-]|$)|_arch_/.test(n)) return "architect";
	if (/review/.test(n)) return "reviewer";
	if (/monitor|supervisor/.test(n)) return "monitor";
	if (/test[_-]?worker/.test(n)) return "test-worker";
	if (/worker/.test(n)) return "worker";
	return "agent";
}

const ROLE_ICON: Record<FleetRoleGuess, string> = {
	architect: "🏛",
	worker: "👷",
	reviewer: "👁",
	monitor: "🛰",
	"test-worker": "🧪",
	agent: "•",
};

function liveStatusOf(name: string, live?: LiveAgent[]): string | undefined {
	return live?.find((l) => l.name === name)?.status;
}

/** A dependency edge parsed from a task's DEPENDENCIES cell. */
export interface DepEdge {
	pod: string;
	fromTask: string;
	dependsOn: string; // raw dependency token (may reference another task or pod)
	crossPod: boolean;
}

/** Collect edges from every pod's task DEPENDENCIES column. */
export function collectEdges(pods: PodBoard[]): DepEdge[] {
	const taskToPod = new Map<string, string>();
	for (const p of pods) for (const t of p.tasks) taskToPod.set(t.taskId, p.pod);

	const edges: DepEdge[] = [];
	for (const p of pods) {
		for (const t of p.tasks) {
			const dep = t.dependencies?.trim();
			if (!dep || dep === "-") continue;
			for (const raw of dep.split(/[,\s]+/).filter(Boolean)) {
				const ownerPod = taskToPod.get(raw);
				edges.push({
					pod: p.pod,
					fromTask: t.taskId,
					dependsOn: raw,
					crossPod: ownerPod !== undefined && ownerPod !== p.pod,
				});
			}
		}
	}
	return edges;
}

function agentLine(a: AgentRow, live: LiveAgent[] | undefined, contextOf?: (agent: string) => number | undefined): string {
	const role = guessRole(a.agent);
	const icon = ROLE_ICON[role];
	const liveStatus = liveStatusOf(a.agent, live);
	// Prefer the live herdr status; fall back to the board's declared state.
	const state = liveStatus ? liveStatus : a.state.toLowerCase();
	const task = a.currentTask && a.currentTask !== "-" ? `  · ${a.currentTask}` : "";
	const pct = contextOf?.(a.agent);
	const ctx = pct !== undefined ? `  ${pct}%ctx` : "";
	return `${icon} ${a.agent.padEnd(22)} ${role.padEnd(11)} ${state}${ctx}${task}`;
}

export function buildTeamTree(input: TeamInput): string[] {
	const lines: string[] = [];
	lines.push(`Wave ${input.waveId} — equipo`);
	lines.push("");

	const masterStatus = input.master ? liveStatusOf(input.master, input.liveAgents) ?? "" : "";
	lines.push(`🎛  ${(input.master ?? "(master)").padEnd(22)} master      ${masterStatus}`.trimEnd());
	lines.push("│");

	input.pods.forEach((pod, pIdx) => {
		const lastPod = pIdx === input.pods.length - 1 && !input.monitor && !input.testArchitect;
		const branch = lastPod ? "└" : "├";
		const base = pod.header["BASE SHA"] ? `  base ${pod.header["BASE SHA"].slice(0, 7)}` : "";
		const arch = pod.header.ARCHITECT ? ` (${pod.header.ARCHITECT})` : "";
		lines.push(`${branch}─■ POD ${pod.pod}${arch}${base}`);
		const pad = lastPod ? "   " : "│  ";
		if (pod.agents.length === 0) {
			lines.push(`${pad}(sin agentes en el board)`);
		} else {
			pod.agents.forEach((a) => lines.push(`${pad}├ ${agentLine(a, input.liveAgents, input.contextOf)}`));
		}
		lines.push(lastPod ? "" : "│");
	});

	if (input.monitor) {
		const st = liveStatusOf(input.monitor, input.liveAgents) ?? "";
		lines.push(`├─🛰 ${input.monitor.padEnd(22)} monitor     ${st}`.trimEnd());
		lines.push("│");
	}

	// Test Pod
	const tpBranch = "└";
	const tw = input.testWorkers ?? [];
	const cap = input.maxTestWorkers ? ` · MAX_TEST_WORKERS=${input.maxTestWorkers}` : "";
	lines.push(`${tpBranch}─🧪 Test Pod${input.testArchitect ? ` (${input.testArchitect})` : ""}${cap}`);
	tw.forEach((w) => {
		const st = liveStatusOf(w, input.liveAgents) ?? "";
		lines.push(`   ├ 🧪 ${w.padEnd(22)} test-worker ${st}`.trimEnd());
	});

	// Dependency graph
	const edges = collectEdges(input.pods);
	lines.push("");
	lines.push("Dependencias:");
	if (edges.length === 0) {
		lines.push("  (ninguna declarada — todos los pods son paralelos)");
	} else {
		for (const e of edges) {
			const tag = e.crossPod ? "cross-pod → serializar" : "data edge (intra-pod)";
			lines.push(`  ${e.pod}·${e.fromTask} ──▶ ${e.dependsOn}   (${tag})`);
		}
	}
	return lines;
}
