import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
	computeReading,
	contextAlerts,
	contextSignature,
	DEFAULT_CONTEXT_THRESHOLDS,
	formatContextMessage,
	parseSessionUsage,
} from "../context-usage.js";

const TH = DEFAULT_CONTEXT_THRESHOLDS; // warn 70, high 85

const SESSION = [
	JSON.stringify({ type: "session", id: "s" }),
	JSON.stringify({ type: "model_change", provider: "openai-codex", modelId: "gpt-5.6-sol" }),
	JSON.stringify({ type: "message", role: "assistant", message: { usage: { totalTokens: 50000, output: 10 } } }),
	JSON.stringify({ type: "message", role: "assistant", message: { usage: { totalTokens: 153973, output: 139 } } }),
].join("\n");

test("parseSessionUsage returns the LAST totalTokens and the model id", () => {
	const u = parseSessionUsage(SESSION);
	assert.ok(u);
	assert.equal(u.totalTokens, 153973);
	assert.equal(u.modelId, "openai-codex/gpt-5.6-sol");
});

test("parseSessionUsage tolerates malformed lines and returns null on fresh session", () => {
	assert.equal(parseSessionUsage("not json\n{bad}\n"), null);
	const onlyModel = JSON.stringify({ type: "model_change", provider: "x", modelId: "y" });
	assert.equal(parseSessionUsage(onlyModel), null); // no usage yet
});

test("computeReading turns tokens + window into a percent", () => {
	const r = computeReading("w1", { totalTokens: 150000, modelId: "p/m" }, 200000);
	assert.ok(r);
	assert.equal(r.percent, 75);
	assert.equal(r.contextWindow, 200000);
	assert.equal(computeReading("w", null, 200000), null);
	assert.equal(computeReading("w", { totalTokens: 1 }, 0), null); // no window
});

test("contextAlerts filters at warn and sorts worst-first", () => {
	const readings = [
		computeReading("a", { totalTokens: 60000 }, 200000)!, // 30% — below warn
		computeReading("b", { totalTokens: 150000 }, 200000)!, // 75% — warn
		computeReading("c", { totalTokens: 180000 }, 200000)!, // 90% — high
	];
	const alerts = contextAlerts(readings, TH);
	assert.deepEqual(alerts.map((r) => r.agent), ["c", "b"]);
});

test("formatContextMessage empty when all below warn, populated with levels", () => {
	const low = [computeReading("a", { totalTokens: 20000 }, 200000)!];
	assert.equal(formatContextMessage(low, TH), "");
	const hi = [
		computeReading("b", { totalTokens: 150000 }, 200000)!, // 75% vigilar
		computeReading("c", { totalTokens: 180000 }, 200000)!, // 90% ALTO
	];
	const msg = formatContextMessage(hi, TH);
	assert.ok(msg.includes("contexto alto"));
	assert.ok(msg.includes("c 90%") && msg.includes("ALTO"));
	assert.ok(msg.includes("b 75%") && msg.includes("vigilar"));
});

test("contextSignature is stable within a 5% bucket, changes crossing high", () => {
	const a = [computeReading("x", { totalTokens: 150000 }, 200000)!]; // 75
	const a2 = [computeReading("x", { totalTokens: 151000 }, 200000)!]; // ~75.5 → same bucket
	const hi = [computeReading("x", { totalTokens: 172000 }, 200000)!]; // 86 → high
	assert.equal(contextSignature(a, TH), contextSignature(a2, TH));
	assert.notEqual(contextSignature(a, TH), contextSignature(hi, TH));
});
