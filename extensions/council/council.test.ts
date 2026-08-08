/**
 * Council E2E test — runs all 3 stages against real OpenRouter models.
 *
 * Usage (requires "type": "module" in package.json to resolve ESM peer deps):
 *   OPENROUTER_API_KEY=sk-... npx tsx extensions/council/council.test.ts
 *
 * Uses cheap paid models for reliability.  Tests:
 *  1. All 3 stage-1 members succeed (no positional failures)
 *  2. Stage-2 peer evaluation produces valid rankings
 *  3. Stage-3 chairman produces non-empty synthesis
 */

import { complete, getModel } from "@earendil-works/pi-ai/compat";
import { runCouncil, type CouncilResult, type ProgressEvent } from "./council.js";
import type { CouncilConfig } from "./config.js";
import type { CouncilModelGateway } from "./openrouter.js";

// ── Config ───────────────────────────────────────────────────────────
const MODELS = [
	"openrouter/google/gemini-3-flash-preview",
	"openrouter/qwen/qwen3-30b-a3b",
	"openrouter/mistralai/mistral-small-3.2-24b-instruct",
];
const CHAIRMAN = "openrouter/google/gemini-3-flash-preview";
const TIMEOUT = 90; // seconds per model

const config: CouncilConfig = {
	models: MODELS,
	chairman: CHAIRMAN,
	timeout: TIMEOUT,
};

// ── Tiny spec to review ──────────────────────────────────────────────
const SPEC = `
# Widget API Spec

## Overview
A REST API that manages widgets. Each widget has a name (string, max 100 chars),
a color (hex string), and a weight (positive float, max 1000kg).

## Endpoints
- POST /widgets — create widget (returns 201)
- GET /widgets/:id — get by id (returns 200 or 404)
- DELETE /widgets/:id — delete by id (returns 204 or 404)

## Auth
All endpoints require a Bearer token in the Authorization header.
Tokens are issued by a separate auth service (not specified here).
`.trim();

// ── Helpers ──────────────────────────────────────────────────────────
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
	console.error("❌ Set OPENROUTER_API_KEY env var");
	process.exit(1);
}

const lookupModel = getModel as unknown as (
	provider: string,
	modelId: string,
) => ReturnType<CouncilModelGateway["resolve"]>;

const modelGateway: CouncilModelGateway = {
	resolve(modelId) {
		const [provider, ...idParts] = modelId.split("/");
		return lookupModel(provider, idParts.join("/"));
	},
	complete(model, context, signal) {
		return complete(model, context, {
			apiKey: apiKey!,
			signal,
			...(model.reasoning ? { reasoningEffort: "medium" } : {}),
		});
	},
};

function icon(ok: boolean) {
	return ok ? "✓" : "✗";
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: string) {
	if (condition) {
		console.log(`  ✅ ${label}`);
		passed++;
	} else {
		console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
		failed++;
	}
}

// ── Run ──────────────────────────────────────────────────────────────
async function main() {
	console.log("🏛️  Council E2E Test\n");
	console.log(`Models: ${MODELS.join(", ")}`);
	console.log(`Chairman: ${CHAIRMAN}`);
	console.log(`Timeout: ${TIMEOUT}s\n`);

	const stageProgress = new Map<string, { stage: number; ok?: boolean; error?: string }>();

	const onStageStart = (stage: 1 | 2 | 3, models: string[]) => {
		const labels: Record<number, string> = {
			1: "Independent review",
			2: "Peer evaluation",
			3: "Chairman synthesis",
		};
		console.log(`\n── Stage ${stage}/3 — ${labels[stage]} ──`);
		console.log(`   Models: ${models.join(", ")}`);
	};

	const onProgress = (stage: 1 | 2 | 3, ev: ProgressEvent) => {
		if (ev.type === "start") {
			stageProgress.set(`${stage}:${ev.model}`, { stage });
			console.log(`   ◐ ${ev.model} started`);
		} else {
			stageProgress.set(`${stage}:${ev.model}`, { stage, ok: ev.ok, error: ev.error });
			console.log(`   ${icon(ev.ok)} ${ev.model}${ev.error ? ` — ${ev.error.slice(0, 120)}` : ""}`);
		}
	};

	let result: CouncilResult;
	const t0 = Date.now();

	try {
		result = await runCouncil(SPEC, "spec", "", config, {
			onStageStart,
			onProgress,
			modelGateway,
		});
	} catch (err) {
		console.error(`\n💥 Council threw: ${err}`);
		process.exit(1);
	}

	const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
	console.log(`\n── Results (${elapsed}s) ──\n`);

	// ── Stage 1 assertions ───────────────────────────────────────────
	console.log("Stage 1 — Independent reviews:");
	assert(result.stage1.length === MODELS.length, `Got ${result.stage1.length}/${MODELS.length} results`);

	const s1ok = result.stage1.filter((r) => !r.failed);
	assert(s1ok.length === MODELS.length, `All ${MODELS.length} models succeeded`, `${s1ok.length} succeeded, failed: ${result.failedModels.join(", ") || "none"}`);

	for (const r of result.stage1) {
		const ok = !r.failed && r.content.trim().length > 50;
		assert(ok, `${r.model} produced content (${r.content.length} chars)`, r.failed ? "FAILED" : `only ${r.content.length} chars`);
	}

	// ── Stage 2 assertions ───────────────────────────────────────────
	console.log("\nStage 2 — Peer evaluations:");
	assert(result.stage2.length > 0, `Got ${result.stage2.length} evaluations`);

	for (const r of result.stage2) {
		assert(r.ranking.length > 0, `${r.reviewerModel} produced ranking (${r.ranking.length} entries)`, "empty ranking");
	}

	assert(result.aggregateRankings.length > 0, `Aggregate rankings computed (${result.aggregateRankings.length} entries)`);

	// ── Stage 3 assertions ───────────────────────────────────────────
	console.log("\nStage 3 — Chairman synthesis:");
	const synthFailed = result.stage3.synthesis.startsWith("⚠️");
	assert(!synthFailed, "Chairman produced synthesis", result.stage3.synthesis.slice(0, 200));
	assert(result.stage3.synthesis.length > 100, `Synthesis length: ${result.stage3.synthesis.length} chars`);

	// ── Cost ─────────────────────────────────────────────────────────
	console.log("\nCost:");
	assert(result.totalCost >= 0, `Total cost captured: $${result.totalCost.toFixed(6)}`);
	console.log(`   Total: $${result.totalCost.toFixed(6)}`);

	// ── Label mappings ───────────────────────────────────────────────
	console.log("\nLabel mappings:");
	for (const [label, model] of Object.entries(result.labelToModel)) {
		console.log(`   ${label} → ${model}`);
	}

	// ── Summary ──────────────────────────────────────────────────────
	console.log(`\n${"═".repeat(50)}`);
	console.log(`✅ ${passed} passed   ❌ ${failed} failed   ⏱  ${elapsed}s`);

	if (failed > 0) {
		console.log("\n⚠️  Some assertions failed — see details above.");
		process.exit(1);
	} else {
		console.log("\n🎉 All assertions passed!");
	}
}

main();
