import * as fs from "node:fs";
import * as path from "node:path";
import { BorderedLoader, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig, saveConfig, CONFIG_PATH, type ReviewType, type CouncilConfig } from "./config.js";
import { runCouncil, type CouncilResult, type ProgressEvent } from "./council.js";
import { createCouncilModelGateway } from "./model-gateway.js";
import { filterModelIds, findModelRemovalIndex } from "./model-picker.js";

type ModelState = "pending" | "running" | "done" | "failed";

const STAGE_LABELS: Record<1 | 2 | 3, string> = {
	1: "Stage 1/3 — Independent review",
	2: "Stage 2/3 — Peer evaluation",
	3: "Stage 3/3 — Chairman synthesis",
};

function renderProgressWidget(
	stage: 1 | 2 | 3,
	states: Map<string, ModelState>,
	errors: Map<string, string>,
): string[] {
	const icon: Record<ModelState, string> = { pending: "○", running: "◐", done: "✓", failed: "✗" };
	const done = [...states.values()].filter((s) => s === "done" || s === "failed").length;
	const total = states.size;
	const lines: string[] = [];
	lines.push(`🏛️  Council — ${STAGE_LABELS[stage]} (${done}/${total})`);
	for (const [model, state] of states) {
		const err = errors.get(model);
		const suffix = state === "failed" && err ? ` — ${err.slice(0, 60)}` : "";
		lines.push(`  ${icon[state]} ${model}${suffix}`);
	}
	return lines;
}

// In-memory store for the last council result (for /council results)
let lastResult: CouncilResult | null = null;

const REVIEW_TYPE_LABELS: Record<ReviewType, string> = {
	spec: "Spec",
	plan: "Plan",
	code: "Code",
};

function formatCompactResult(result: CouncilResult): string {
	const lines: string[] = [];

	// Stage 3: Chairman synthesis (main output)
	lines.push("## 🏛️ Council Synthesis\n");
	lines.push(result.stage3.synthesis);
	lines.push("");

	// If chairman failed, show the top-ranked review as fallback
	const synthesisFailed = result.stage3.synthesis.startsWith("⚠️");
	if (synthesisFailed && result.aggregateRankings.length > 0) {
		const topModel = result.aggregateRankings[0].model;
		const topReview = result.stage1.find((r) => r.model === topModel && !r.failed);
		if (topReview) {
			lines.push("---\n");
			lines.push(`### 🥇 Top-ranked review (${topModel})\n`);
			lines.push(topReview.content);
			lines.push("");
		}
	}

	if (result.aggregateRankings.length > 0) {
		lines.push("---\n");
		const medals = ["🥇", "🥈", "🥉"];
		lines.push("📊 **Peer Rankings** — council members voted on which review was most useful:\n");
		result.aggregateRankings.forEach((r, i) => {
			const medal = medals[i] ?? `${i + 1}.`;
			// One line per reviewer: who ranked this model where
			const votes = result.stage2
				.map((s2) => {
					const pos = s2.ranking.indexOf(result.modelToLabel[r.model]);
					if (pos === -1) return null;
					// Use this reviewer's ranking length (they skip their own review)
					const last = s2.ranking.length - 1;
					const place = pos === 0 ? "best" : pos === last ? "worst" : `#${pos + 1}`;
					const reviewer = result.modelToLabel[s2.reviewerModel] ?? s2.reviewerModel;
					return `${reviewer} → ${place}`;
				})
				.filter(Boolean)
				.join("  |  ");
			lines.push(`${medal} \`${r.model}\``);
			if (votes) lines.push(`   ${votes}`);
		});
	}

	if (result.failedModels.length > 0) {
		lines.push("");
		lines.push(`⚠️ Models excluded due to errors: ${result.failedModels.join(", ")}`);
	}

	lines.push("");
	const costStr = result.totalCost < 0.001
		? "< $0.001"
		: `$${result.totalCost.toFixed(4)}`;
	lines.push(`_Cost: ${costStr} — Run \`/council results\` for full details_`);

	return lines.join("\n");
}

function formatFullResult(result: CouncilResult): string {
	const lines: string[] = [];

	lines.push("# 🏛️ Council Full Results\n");

	lines.push("## Stage 1 — Individual Reviews\n");
	for (const r of result.stage1) {
		if (r.failed) {
			lines.push(`### ❌ ${r.model} (failed)\n`);
			continue;
		}
		lines.push(`### ${r.model}\n`);
		lines.push(r.content);
		lines.push("");
	}

	lines.push("---\n");
	lines.push("## Stage 2 — Peer Evaluations\n");
	for (const r of result.stage2) {
		lines.push(`### Evaluation by ${r.reviewerModel}\n`);
		lines.push(r.evaluationText);
		lines.push("");
		if (r.ranking.length > 0) {
			const namedRanking = r.ranking
				.map((label, i) => `${i + 1}. ${result.labelToModel[label] ?? label}`)
				.join("\n");
			lines.push(`**Parsed ranking:**\n${namedRanking}`);
		}
		lines.push("");
	}

	lines.push("---\n");
	lines.push("## Stage 3 — Chairman Synthesis\n");
	lines.push(`_Chairman: ${result.stage3.chairmanModel}_\n`);
	lines.push(result.stage3.synthesis);

	return lines.join("\n");
}

// Pick a model from a bounded search result without mutating Pi's default.
async function pickModel(
	ctx: Parameters<Parameters<ExtensionAPI["registerCommand"]>[1]["handler"]>[1],
	title: string,
	currentModelId?: string,
): Promise<string | undefined> {
	const query = await ctx.ui.input(
		`${title} — search by provider or model`,
		currentModelId ?? "provider/model",
	);
	if (query === undefined) return undefined;
	if (!query.trim()) return currentModelId;

	const modelIds = ctx.modelRegistry
		.getAvailable()
		.map((model) => `${model.provider}/${model.id}`)
		.sort((a, b) => a.localeCompare(b));
	const matches = filterModelIds(modelIds, query);

	if (matches.length === 0) {
		ctx.ui.notify(`No available models match "${query.trim()}".`, "warning");
		return undefined;
	}

	return ctx.ui.select(`${title} (${matches.length} matches, max 50)`, matches);
}

export default function (pi: ExtensionAPI) {
	// /council-setup — configure council models and chairman
	pi.registerCommand("council-setup", {
		description: "Configure council models and chairman",
		handler: async (_args, ctx) => {
			// Load existing config (or defaults)
			const existing = loadConfig();
			const current: CouncilConfig = existing.ok
				? existing.config
				: { models: [], chairman: "", timeout: 120 };

			// Show current state
			const currentSummary = current.models.length > 0
				? `Current: ${current.models.length} models, chairman: ${current.chairman}`
				: "No config yet";
			ctx.ui.notify(currentSummary, "info");

			// Step 1: pick council models (loop until done)
			const models: string[] = [...current.models];

			while (true) {
				const summary = models.length === 0
					? "No models yet (need at least 2)"
					: models.map((m, i) => `${i + 1}. ${m}`).join("  |  ");

				const action = await ctx.ui.select(
					`🏛️ Council models (${models.length}):\n${summary}`,
					[
						"➕ Add a model",
						...models.map((m, i) => `❌ Remove: ${m}`),
						"✅ Done selecting models",
					],
				);
				if (!action || action === "✅ Done selecting models") break;

				if (action === "➕ Add a model") {
					const picked = await pickModel(ctx, "Add council model");
					if (picked && !models.includes(picked)) models.push(picked);
					else if (picked) ctx.ui.notify("Model already in council.", "warning");
				} else {
					const removeIdx = findModelRemovalIndex(models, action);
					if (removeIdx !== -1) models.splice(removeIdx, 1);
				}
			}

			if (models.length < 2) {
				ctx.ui.notify("Need at least 2 models. Setup cancelled.", "warning");
				return;
			}

			// Step 2: pick chairman
			const chairmanChoice = await ctx.ui.select(
				"👑 Who should be the chairman (synthesizer)?",
				[
					...models.map((m) => `From council: ${m}`),
					"🔍 Pick a different model",
				],
			);
			if (!chairmanChoice) return;

			let chairman: string;
			if (chairmanChoice === "🔍 Pick a different model") {
				const picked = await pickModel(ctx, "Pick chairman model", current.chairman);
				if (!picked) return;
				chairman = picked;
			} else {
				chairman = models.find((m) => chairmanChoice.includes(m))!;
			}

			// Step 3: confirm + save
			const confirmed = await ctx.ui.confirm(
				"💾 Save council config?",
				`Models:\n${models.map((m, i) => `  ${i + 1}. ${m}`).join("\n")}\n\nChairman: ${chairman}\n\nSaved to: ${CONFIG_PATH}`,
			);
			if (!confirmed) return;

			saveConfig({ models, chairman, timeout: current.timeout });
			ctx.ui.notify(`✅ Council config saved! ${models.length} models + chairman: ${chairman}`, "info");
		},
	});

	// /council results — show full detail of last run
	pi.registerCommand("council-results", {
		description: "Show full details of the last council review",
		handler: async (_args, ctx) => {
			if (!lastResult) {
				ctx.ui.notify("No council results available. Run /council first.", "warning");
				return;
			}
			pi.sendMessage(
				{ customType: "council", content: formatFullResult(lastResult), display: true },
				{ triggerTurn: false },
			);
		},
	});

	// /council — interactive review launcher
	pi.registerCommand("council", {
		description: "Run a council review on a spec, plan, or code file",
		handler: async (_args, ctx) => {
			// Check config first
			const configResult = loadConfig();
			if (configResult.ok === false) {
				ctx.ui.notify(configResult.error, "warning");
				return;
			}
			const config = configResult.config;

			// Step 1: Review type
			const reviewTypeLabels = ["Spec", "Plan", "Code"] as const;
			const reviewTypeValues: ReviewType[] = ["spec", "plan", "code"];
			const reviewTypeChoice = await ctx.ui.select("What do you want to review?", [...reviewTypeLabels]);
			if (!reviewTypeChoice) return;
			const reviewType = reviewTypeValues[reviewTypeLabels.indexOf(reviewTypeChoice as (typeof reviewTypeLabels)[number])];

			// Step 2: File path
			const filePath = await ctx.ui.input(`Path to the ${REVIEW_TYPE_LABELS[reviewType]} file:`);
			if (!filePath?.trim()) return;

			const resolvedPath = path.resolve(ctx.cwd, filePath.trim());
			if (!fs.existsSync(resolvedPath)) {
				ctx.ui.notify(`File not found: ${resolvedPath}`, "warning");
				return;
			}

			const content = fs.readFileSync(resolvedPath, "utf-8").trim();
			if (!content) {
				ctx.ui.notify("File is empty.", "warning");
				return;
			}

			// Step 3: Extra instructions — multiline editor (Esc = skip, Ctrl+D = cancel)
			const extraInstructionsInput = await ctx.ui.editor("Additional instructions (Esc to skip):");
			if (extraInstructionsInput === null) return;
			const extraInstructions = extraInstructionsInput ?? "";

			// Run the council inside a cancellable loader + live progress widget
			const WIDGET_ID = "council-progress";
			let currentStage: 1 | 2 | 3 = 1;
			const states = new Map<string, ModelState>();
			const errors = new Map<string, string>();

			const paint = () => ctx.ui.setWidget(WIDGET_ID, renderProgressWidget(currentStage, states, errors), { placement: "aboveEditor" });

			const handleStageStart = (stage: 1 | 2 | 3, models: string[]) => {
				currentStage = stage;
				states.clear();
				errors.clear();
				for (const m of models) states.set(m, "pending");
				paint();
			};

			const handleProgress = (_stage: 1 | 2 | 3, ev: ProgressEvent) => {
				if (ev.type === "start") {
					states.set(ev.model, "running");
				} else {
					states.set(ev.model, ev.ok ? "done" : "failed");
					if (!ev.ok && ev.error) errors.set(ev.model, ev.error);
				}
				paint();
			};

			type RunOutcome = { ok: true; result: CouncilResult } | { ok: false; cancelled: true } | { ok: false; error: string };

			const modelGateway = createCouncilModelGateway(ctx.modelRegistry);

			const outcome = await ctx.ui.custom<RunOutcome>((tui, theme, _kb, done) => {
				const loader = new BorderedLoader(tui, theme, `🏛️ Council starting — ${STAGE_LABELS[1]}...`);
				loader.onAbort = () => done({ ok: false, cancelled: true });

				runCouncil(content, reviewType, extraInstructions, config, {
					onStageStart: handleStageStart,
					onProgress: handleProgress,
					modelGateway,
					signal: loader.signal,
				})
					.then((result) => done({ ok: true, result }))
					.catch((err) => done({ ok: false, error: err instanceof Error ? err.message : String(err) }));

				return loader;
			});

			ctx.ui.setWidget(WIDGET_ID, undefined);

			if (outcome.ok === false) {
				if ("cancelled" in outcome) {
					ctx.ui.notify("Council cancelled.", "info");
				} else {
					ctx.ui.notify(outcome.error, "error");
				}
				return;
			}

			lastResult = outcome.result;

			// Notify if chairman failed so the user knows why
			const synthesis = outcome.result.stage3.synthesis;
			if (synthesis.startsWith("⚠️")) {
				ctx.ui.notify(synthesis.replace(/\*\*/g, ""), "error");
			}

			pi.sendMessage(
				{ customType: "council", content: formatCompactResult(outcome.result), display: true },
				{ triggerTurn: false },
			);
		},
	});
}
