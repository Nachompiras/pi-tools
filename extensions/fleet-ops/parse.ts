/**
 * Pure parsers for the orchestrating-agent-fleets coordination files.
 *
 * These read the same files scripts/fleet.sh writes under
 * .orchestration/wave-<id>/ :
 *   - pod-<p>-kanban.md    (architect-maintained agent + task tables)
 *   - test-pod-kanban.md   (test architect header)
 *   - test-registry.tsv    (authoritative expensive-test dedup registry)
 *   - expected-pods        (declared pods for silent-failure detection)
 *   - pod-<p>-handoff.md    (presence = pod done)
 *
 * Kept dependency-free and side-effect-free so they can be unit tested.
 */

export interface KanbanHeader {
	[key: string]: string;
}

export interface AgentRow {
	agent: string;
	state: string;
	currentTask: string;
	lastTask: string;
	lastSha: string;
	since: string;
	nextCheckIn: string;
}

export interface TaskRow {
	taskId: string;
	status: string;
	owner: string;
	scope: string;
	branch: string;
	sha: string;
	dependencies: string;
	nextCheckIn: string;
}

export interface PodBoard {
	pod: string;
	header: KanbanHeader;
	agents: AgentRow[];
	tasks: TaskRow[];
}

export interface TestRegistryRow {
	execKey: string;
	status: string;
	targetSha: string;
	command: string;
	env: string;
	config: string;
	attempt: string;
	worker: string;
	evidence: string;
}

export const AGENT_STATES = ["ACTIVE", "IDLE", "BLOCKED", "WAITING_REVIEW", "WAITING_TEST", "OFFLINE"] as const;
export const TASK_STATUSES = ["BACKLOG", "READY", "IN_PROGRESS", "REVIEW", "WAITING_TEST", "DONE", "BLOCKED"] as const;

/** Parse `KEY: value` header lines that appear before the first `##` section. */
export function parseHeader(md: string): KanbanHeader {
	const header: KanbanHeader = {};
	for (const rawLine of md.split("\n")) {
		const line = rawLine.trim();
		if (line.startsWith("#")) break; // header block ends at first markdown section
		const m = line.match(/^([A-Z][A-Z0-9_ /()]*?):\s*(.*)$/);
		if (m) header[m[1].trim()] = m[2].trim();
	}
	return header;
}

/**
 * Parse every markdown table in the document into arrays of cell arrays.
 * Skips the separator row (|---|---|). Ignores HTML comment lines.
 */
function parseTables(md: string): string[][][] {
	const tables: string[][][] = [];
	let current: string[][] | null = null;
	for (const rawLine of md.split("\n")) {
		const line = rawLine.trim();
		if (line.startsWith("|") && line.endsWith("|")) {
			const cells = line
				.slice(1, -1)
				.split("|")
				.map((c) => c.trim());
			// separator row: every cell is only dashes/colons
			if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
			if (!current) {
				current = [];
				tables.push(current);
			}
			current.push(cells);
		} else {
			current = null;
		}
	}
	return tables;
}

/** True when a header-row's cells look like the given column set (first cell match). */
function tableStartsWith(rows: string[][], firstCol: string): boolean {
	return rows.length > 0 && rows[0][0]?.toUpperCase() === firstCol.toUpperCase();
}

export function parsePodBoard(pod: string, md: string): PodBoard {
	const header = parseHeader(md);
	const tables = parseTables(md);
	const agents: AgentRow[] = [];
	const tasks: TaskRow[] = [];

	for (const rows of tables) {
		if (tableStartsWith(rows, "AGENT")) {
			for (const r of rows.slice(1)) {
				agents.push({
					agent: r[0] ?? "",
					state: (r[1] ?? "").toUpperCase(),
					currentTask: r[2] ?? "",
					lastTask: r[3] ?? "",
					lastSha: r[4] ?? "",
					since: r[5] ?? "",
					nextCheckIn: r[6] ?? "",
				});
			}
		} else if (tableStartsWith(rows, "TASK ID")) {
			for (const r of rows.slice(1)) {
				tasks.push({
					taskId: r[0] ?? "",
					status: (r[1] ?? "").toUpperCase(),
					owner: r[2] ?? "",
					scope: r[3] ?? "",
					branch: r[4] ?? "",
					sha: r[5] ?? "",
					dependencies: r[6] ?? "",
					nextCheckIn: r[7] ?? "",
				});
			}
		}
	}
	return { pod, header, agents, tasks };
}

/** Parse the tab-separated authoritative test registry (skips header row). */
export function parseTestRegistry(tsv: string): TestRegistryRow[] {
	const out: TestRegistryRow[] = [];
	const lines = tsv.split("\n").filter((l) => l.length > 0);
	for (const line of lines.slice(1)) {
		const c = line.split("\t");
		if (c[0] === "EXEC_KEY") continue;
		out.push({
			execKey: c[0] ?? "",
			status: (c[1] ?? "").toUpperCase(),
			targetSha: c[2] ?? "",
			command: c[3] ?? "",
			env: c[4] ?? "",
			config: c[5] ?? "",
			attempt: c[6] ?? "",
			worker: c[7] ?? "",
			evidence: c[8] ?? "",
		});
	}
	return out;
}

/** Parse the newline-delimited expected-pods file. */
export function parseExpectedPods(text: string): string[] {
	return text
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.length > 0);
}

/** Count occurrences keyed by an uppercased field, preserving a stable order. */
export function countBy<T>(rows: T[], key: (r: T) => string, order: readonly string[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const label of order) counts.set(label, 0);
	for (const r of rows) {
		const k = key(r);
		counts.set(k, (counts.get(k) ?? 0) + 1);
	}
	// drop zero-count known labels handled by caller; keep unknowns that appeared
	return counts;
}

/**
 * A board is stale if BOARD STATUS says STALE, or its NEXT_CHECK_IN /
 * LAST UPDATED is a real timestamp in the past. Timestamp parsing is
 * intentionally lenient: only a parseable ISO/date string counts.
 */
export function isBoardStale(header: KanbanHeader, now: number): boolean {
	if ((header["BOARD STATUS"] ?? "").toUpperCase() === "STALE") return true;
	const updated = header["LAST UPDATED"];
	if (updated) {
		const t = Date.parse(updated);
		if (!Number.isNaN(t) && now - t > 24 * 60 * 60 * 1000) return true;
	}
	return false;
}
