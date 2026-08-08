import assert from "node:assert/strict";
import tokenSpeedExtension from "../extensions/token-speed/index.js";
import {
	TokenSpeedTracker,
	formatRate,
	formatStatus,
} from "../extensions/token-speed/tracker.js";

assert.equal(formatRate(123.6), "124");
assert.equal(formatRate(45.27), "45.3");
assert.equal(formatRate(8.126), "8.13");
assert.equal(formatRate(undefined), "-");

const live = new TokenSpeedTracker();
live.beginRequest(0);
live.recordDelta("abcdefghij", 1_000);
live.recordDelta("abcdefghij", 2_000);
live.recordDelta("abcde", 3_000);
assert.equal(live.getMetrics(3_000).tps, 2.5, "counts text, thinking, and tool-call output deltas");
assert.ok(
	Math.abs((live.getMetrics(7_001).tps ?? 0) - 0.2499375) < 0.000001,
	"drops samples outside the five-second live window",
);

const completed = new TokenSpeedTracker();
completed.beginRequest(100);
completed.recordDelta("first", 600);
completed.recordDelta("last", 1_600);
completed.finishMessage(100, "stop");
assert.deepEqual(completed.getMetrics(1_700), {
	tps: 100,
	averageTps: 100,
	averageTtftMs: 500,
});

completed.beginRequest(2_000);
completed.recordDelta("first", 2_400);
completed.recordDelta("last", 4_400);
completed.finishMessage(100, "toolUse");
const aggregate = completed.getMetrics(4_500);
assert.equal(aggregate.tps, 50, "idle TPS keeps the latest completed response rate");
assert.ok(Math.abs((aggregate.averageTps ?? 0) - 200 / 3) < 0.000001, "AVG is output-token weighted");
assert.equal(aggregate.averageTtftMs, 450, "TTFT averages completed requests");

completed.beginRequest(5_000);
completed.recordDelta("first", 5_100);
completed.recordDelta("last", 6_100);
completed.finishMessage(500, "aborted");
assert.equal(completed.getMetrics(6_200).tps, 50, "aborted output does not replace completed metrics");
assert.ok(Math.abs((completed.getMetrics(6_200).averageTps ?? 0) - 200 / 3) < 0.000001);

const incomplete = new TokenSpeedTracker();
for (const stopReason of ["pending", "deferred"]) {
	incomplete.beginRequest(0);
	incomplete.recordDelta("first", 100);
	incomplete.recordDelta("last", 1_100);
	incomplete.finishMessage(100, stopReason);
}
assert.deepEqual(incomplete.getMetrics(1_200), {
	tps: undefined,
	averageTps: undefined,
	averageTtftMs: undefined,
});

assert.equal(
	formatStatus({ tps: 45.27, averageTps: 38.14, averageTtftMs: 812 }),
	"TPS 45.3 | AVG 38.1 | TTFT 0.8s",
);

completed.reset();
assert.deepEqual(completed.getMetrics(7_000), {
	tps: undefined,
	averageTps: undefined,
	averageTtftMs: undefined,
});

const handlers = new Map<string, (event: any, ctx: any) => unknown>();
const statuses: Array<{ key: string; text: string | undefined }> = [];
const fakePi = {
	on(name: string, handler: (event: any, ctx: any) => unknown) {
		handlers.set(name, handler);
	},
};
const fakeCtx = {
	hasUI: true,
	ui: {
		theme: { fg: (_color: string, text: string) => text },
		setStatus: (key: string, text: string | undefined) => statuses.push({ key, text }),
	},
};

tokenSpeedExtension(fakePi as any);
const realNow = Date.now;
let now = 100;
Date.now = () => now;
try {
	handlers.get("session_start")?.({}, fakeCtx);
	assert.deepEqual(statuses.at(-1), { key: "token-speed", text: "TPS - | AVG - | TTFT -" });

	handlers.get("before_provider_request")?.({ payload: {} }, fakeCtx);
	now = 600;
	handlers.get("message_update")?.(
		{ assistantMessageEvent: { type: "text_delta", delta: "first" } },
		fakeCtx,
	);
	now = 1_100;
	handlers.get("message_update")?.(
		{ assistantMessageEvent: { type: "thinking_delta", delta: "middle" } },
		fakeCtx,
	);
	now = 1_600;
	handlers.get("message_update")?.(
		{ assistantMessageEvent: { type: "toolcall_delta", delta: "last" } },
		fakeCtx,
	);
	handlers.get("message_end")?.(
		{ message: { role: "assistant", usage: { output: 100 }, stopReason: "stop" } },
		fakeCtx,
	);
	assert.deepEqual(statuses.at(-1), {
		key: "token-speed",
		text: "TPS 100 | AVG 100 | TTFT 0.5s",
	});
} finally {
	Date.now = realNow;
}

console.log("token-speed: all tests passed");
