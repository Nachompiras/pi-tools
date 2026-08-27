import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parsePodBoard } from "../parse.js";
import {
	formatWatchdogMessage,
	parseCheckIn,
	runWatchdog,
	watchdogSignature,
} from "../watchdog.js";
import { buildTeamTree, collectEdges, guessRole } from "../team.js";

const NOW = Date.parse("2099-06-15T12:00:00Z");

function board(pod: string, agentRows: string, taskRows: string, header = ""): ReturnType<typeof parsePodBoard> {
	const md = `WAVE: w
POD: ${pod}
ARCHITECT: Arch-${pod}
BASE SHA: deadbeef1234567
${header}
## Agents
| AGENT | STATE | CURRENT TASK | LAST TASK | LAST SHA | SINCE | NEXT_CHECK_IN |
|-------|-------|--------------|-----------|----------|-------|---------------|
${agentRows}
## Tasks
| TASK ID | STATUS | OWNER | SCOPE | BRANCH | SHA | DEPENDENCIES | NEXT_CHECK_IN |
|---------|--------|-------|-------|--------|-----|--------------|---------------|
${taskRows}
`;
	return parsePodBoard(pod, md);
}

// ---------------- watchdog ----------------

test("parseCheckIn handles ISO, HH:MM, and rejects placeholders", () => {
	assert.equal(parseCheckIn("2099-06-15T11:00:00Z", NOW), Date.parse("2099-06-15T11:00:00Z"));
	assert.equal(parseCheckIn("-", NOW), null);
	assert.equal(parseCheckIn("+30m", NOW), null);
	assert.equal(parseCheckIn("", NOW), null);
	// HH:MM resolves to today local — just assert it's a number
	assert.equal(typeof parseCheckIn("09:30", NOW), "number");
});

test("runWatchdog flags overdue ISO check-ins, ignores fresh + terminal", () => {
	const b = board(
		"a",
		// W1 overdue (11:00 < 12:00), W2 fresh (13:00 > 12:00), W3 OFFLINE ignored
		`| W1 | ACTIVE | T1 | - | - | 10:00 | 2099-06-15T11:00:00Z |
| W2 | ACTIVE | T2 | - | - | 10:00 | 2099-06-15T13:00:00Z |
| W3 | OFFLINE | - | T0 | abc | 09:00 | 2099-06-15T01:00:00Z |`,
		// T1 overdue, T9 DONE ignored
		`| T1 | IN_PROGRESS | W1 | s/a | b/1 | - | - | 2099-06-15T11:00:00Z |
| T9 | DONE | W1 | s/a | b/9 | abc | - | 2099-06-15T01:00:00Z |`,
	);
	const r = runWatchdog([b], NOW);
	const ids = r.overdue.map((e) => `${e.kind}:${e.id}`).sort();
	assert.deepEqual(ids, ["agent:W1", "task:T1"]);
	// W3 (OFFLINE) and T9 (DONE) must not appear despite past timestamps
	assert.ok(!r.overdue.some((e) => e.id === "W3" || e.id === "T9"));
	assert.ok(r.overdue[0].overdueSeconds > 0);
});

test("runWatchdog reports active entries with no usable check-in as unparseable", () => {
	const b = board(
		"a",
		`| W1 | ACTIVE | T1 | - | - | 10:00 | +30m |`, // relative placeholder → unparseable
		`| T1 | IN_PROGRESS | W1 | s/a | b/1 | - | - | - |`, // no check-in → unparseable
	);
	const r = runWatchdog([b], NOW);
	assert.equal(r.overdue.length, 0);
	assert.equal(r.unparseable.length, 2);
});

test("watchdogSignature is stable for the same overdue set and changes when state changes", () => {
	const b1 = board("a", `| W1 | ACTIVE | T1 | - | - | 10:00 | 2099-06-15T11:00:00Z |`, ``);
	const b2 = board("a", `| W1 | BLOCKED | T1 | - | - | 10:00 | 2099-06-15T11:00:00Z |`, ``);
	assert.equal(watchdogSignature(runWatchdog([b1], NOW)), watchdogSignature(runWatchdog([b1], NOW)));
	assert.notEqual(watchdogSignature(runWatchdog([b1], NOW)), watchdogSignature(runWatchdog([b2], NOW)));
});

test("formatWatchdogMessage is empty when all fresh, populated when overdue", () => {
	const fresh = board("a", `| W1 | ACTIVE | T1 | - | - | 10:00 | 2099-06-15T13:00:00Z |`, ``);
	assert.equal(formatWatchdogMessage(runWatchdog([fresh], NOW)), "");
	const late = board("a", `| W1 | ACTIVE | T1 | - | - | 10:00 | 2099-06-15T11:00:00Z |`, ``);
	const msg = formatWatchdogMessage(runWatchdog([late], NOW));
	assert.ok(msg.includes("Watchdog") && msg.includes("W1") && msg.includes("architect"));
});

// ---------------- team ----------------

test("guessRole infers roles from agent handles", () => {
	assert.equal(guessRole("fernolan_arch_a"), "architect");
	assert.equal(guessRole("fernolan_worker_b1"), "worker");
	assert.equal(guessRole("fernolan_review_a"), "reviewer");
	assert.equal(guessRole("s00t2p_monitor"), "monitor");
	assert.equal(guessRole("legacy_supervisor"), "monitor"); // back-compat name still maps
	assert.equal(guessRole("s00t2p_test_worker_1"), "test-worker");
	assert.equal(guessRole("random_name"), "agent");
});

test("collectEdges reads DEPENDENCIES column and marks cross-pod", () => {
	const a = board("a", ``, `| T1 | IN_PROGRESS | W1 | s/a | b/1 | - | - | - |
| T2 | BLOCKED | W2 | s/a | b/2 | - | T1 | - |`);
	const b = board("b", ``, `| T3 | BLOCKED | W3 | s/b | b/3 | - | T1 | - |`); // T1 lives in pod a → cross-pod
	const edges = collectEdges([a, b]);
	const intra = edges.find((e) => e.pod === "a" && e.fromTask === "T2");
	const cross = edges.find((e) => e.pod === "b" && e.fromTask === "T3");
	assert.ok(intra && !intra.crossPod);
	assert.ok(cross && cross.crossPod);
});

test("buildTeamTree renders master, pods, agents, and dependency section", () => {
	const a = board(
		"a",
		`| fernolan_worker_a1 | ACTIVE | T1 | - | - | 10:00 | 10:30 |`,
		`| T1 | IN_PROGRESS | fernolan_worker_a1 | s/a | b/1 | - | - | 10:30 |`,
	);
	const lines = buildTeamTree({
		waveId: "w",
		pods: [a],
		master: "fernolan_master",
		monitor: "fernolan_monitor",
		liveAgents: [{ name: "fernolan_worker_a1", status: "working" }],
	});
	const txt = lines.join("\n");
	assert.ok(txt.includes("fernolan_master"));
	assert.ok(txt.includes("POD a"));
	assert.ok(txt.includes("fernolan_worker_a1") && txt.includes("working")); // live status wins
	assert.ok(txt.includes("fernolan_monitor"));
	assert.ok(txt.includes("Dependencias:"));
});

test("buildTeamTree shows 'todos paralelos' when no edges", () => {
	const a = board("a", `| w1 | ACTIVE | T1 | - | - | - | - |`, `| T1 | IN_PROGRESS | w1 | s | b | - | - | - |`);
	const txt = buildTeamTree({ waveId: "w", pods: [a] }).join("\n");
	assert.ok(txt.includes("paralelos"));
});
