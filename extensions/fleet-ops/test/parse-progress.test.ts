import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
	isBoardStale,
	parseExpectedPods,
	parseHeader,
	parsePodBoard,
	parseTestRegistry,
} from "../parse.js";
import { buildProgressReport, type WaveSnapshot } from "../progress.js";

const SAMPLE_BOARD = `WAVE: 001
POD: a
ARCHITECT: Architect-A
BASE SHA: d310fbd
LAST UPDATED: 2099-01-01T00:00:00Z
BOARD STATUS: CURRENT

## Agents
| AGENT | STATE | CURRENT TASK | LAST TASK | LAST SHA | SINCE | NEXT_CHECK_IN |
|-------|-------|--------------|-----------|----------|-------|---------------|
| A1 | ACTIVE | T1 | - | - | 10:00 | 10:30 |
| A2 | IDLE | - | T0 | abc | 09:00 | 10:30 |
| A3 | BLOCKED | T2 | - | - | 09:30 | 10:00 |

<!-- STATE comment ignored -->

## Tasks
| TASK ID | STATUS | OWNER | SCOPE | BRANCH | SHA | DEPENDENCIES | NEXT_CHECK_IN |
|---------|--------|-------|-------|--------|-----|--------------|---------------|
| T0 | DONE | A2 | src/x | b/0 | abc | - | - |
| T1 | IN_PROGRESS | A1 | src/y | b/1 | - | - | 10:30 |
| T2 | BLOCKED | A3 | src/z | b/2 | - | T1 | 10:00 |
| T3 | READY | - | src/w | - | - | - | - |
`;

test("parseHeader reads key/value lines and stops at first section", () => {
	const h = parseHeader(SAMPLE_BOARD);
	assert.equal(h.WAVE, "001");
	assert.equal(h.POD, "a");
	assert.equal(h.ARCHITECT, "Architect-A");
	assert.equal(h["BOARD STATUS"], "CURRENT");
	assert.equal(h.AGENT, undefined); // table header must not leak in
});

test("parsePodBoard parses agent and task tables, skips separators and comments", () => {
	const b = parsePodBoard("a", SAMPLE_BOARD);
	assert.equal(b.agents.length, 3);
	assert.equal(b.tasks.length, 4);
	assert.equal(b.agents[0].agent, "A1");
	assert.equal(b.agents[0].state, "ACTIVE");
	assert.equal(b.agents[2].state, "BLOCKED");
	assert.equal(b.tasks[0].status, "DONE");
	assert.equal(b.tasks[3].status, "READY");
	assert.equal(b.tasks[2].dependencies, "T1");
});

test("parseTestRegistry skips header, parses rows and preserves attempts", () => {
	const tsv = [
		"EXEC_KEY\tSTATUS\tTARGET_SHA\tCOMMAND\tENV\tCONFIG\tATTEMPT\tWORKER\tEVIDENCE\tSUBSCRIBERS",
		"k1\tFAILED\tsha1\tnpm test\tci\tdefault\t1\ttw1\tlogs/1\t",
		"k1\tPASSED\tsha1\tnpm test\tci\tdefault\t2\ttw1\tlogs/2\t",
	].join("\n");
	const rows = parseTestRegistry(tsv);
	assert.equal(rows.length, 2);
	assert.equal(rows[0].status, "FAILED");
	assert.equal(rows[1].status, "PASSED");
	assert.equal(rows[1].attempt, "2");
});

test("parseExpectedPods ignores blank lines", () => {
	assert.deepEqual(parseExpectedPods("a\nb\n\n c \n"), ["a", "b", "c"]);
});

test("isBoardStale detects explicit STALE and old timestamps", () => {
	const now = Date.parse("2099-01-03T00:00:00Z");
	assert.equal(isBoardStale({ "BOARD STATUS": "STALE" }, now), true);
	assert.equal(isBoardStale({ "BOARD STATUS": "CURRENT", "LAST UPDATED": "2099-01-01T00:00:00Z" }, now), true);
	assert.equal(isBoardStale({ "BOARD STATUS": "CURRENT", "LAST UPDATED": "2099-01-03T00:00:00Z" }, now), false);
	assert.equal(isBoardStale({ "BOARD STATUS": "CURRENT" }, now), false);
});

function snapshotWith(overrides: Partial<WaveSnapshot> = {}): WaveSnapshot {
	const board = parsePodBoard("a", SAMPLE_BOARD);
	return {
		waveId: "001",
		pods: [board],
		expectedPods: ["a", "b"],
		handoffPods: ["a"],
		testRegistry: [],
		staleBoards: [],
		...overrides,
	};
}

test("buildProgressReport flags missing pod handoff", () => {
	const r = buildProgressReport(snapshotWith());
	assert.equal(r.needsAttention, true);
	assert.ok(r.attention.some((a) => a.includes("Missing pod handoff") && a.includes("b")));
});

test("buildProgressReport shows in-flight work with owner and scope", () => {
	const r = buildProgressReport(snapshotWith({ expectedPods: [], handoffPods: [] }));
	const joined = r.lines.join("\n");
	// T1 IN_PROGRESS owned by A1 on scope src/y
	assert.ok(joined.includes("T1 src/y") && joined.includes("A1"), joined);
	// T2 BLOCKED owned by A3 waiting on T1
	assert.ok(joined.includes("T2 src/z") && joined.includes("BLOCKED") && joined.includes("waiting on T1"), joined);
});

test("buildProgressReport flags blocked agent and idle-with-work", () => {
	const r = buildProgressReport(snapshotWith({ expectedPods: [], handoffPods: [] }));
	assert.ok(r.attention.some((a) => a.includes("BLOCKED")));
	assert.ok(r.attention.some((a) => a.includes("idle agent")));
});

test("buildProgressReport surfaces failed tests", () => {
	const r = buildProgressReport(
		snapshotWith({
			expectedPods: [],
			handoffPods: [],
			testRegistry: parseTestRegistry(
				"EXEC_KEY\tSTATUS\tTARGET_SHA\tCOMMAND\tENV\tCONFIG\tATTEMPT\tWORKER\tEVIDENCE\tSUBSCRIBERS\nk\tFAILED\tabcdef123456\tnpm test\tci\tdefault\t1\ttw1\tlogs/1\t",
			),
		}),
	);
	assert.ok(r.attention.some((a) => a.includes("Test FAILED")));
});

test("buildProgressReport is clean when all good", () => {
	const board = parsePodBoard("a", SAMPLE_BOARD.replace("| A3 | BLOCKED | T2 | - | - | 09:30 | 10:00 |\n", ""));
	const r = buildProgressReport({
		waveId: "001",
		pods: [board],
		expectedPods: ["a"],
		handoffPods: ["a"],
		testRegistry: [],
		staleBoards: [],
	});
	// A2 idle + T3 ready still triggers a (correct) dispatch suggestion, so
	// assert specifically that there is no missing-handoff / blocked / stale noise.
	assert.ok(!r.attention.some((a) => a.includes("Missing")));
	assert.ok(!r.attention.some((a) => a.includes("BLOCKED")));
	assert.ok(!r.attention.some((a) => a.includes("STALE")));
});
