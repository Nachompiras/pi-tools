/**
 * Fleet Ops Extension
 *
 * Companion to the orchestrating-agent-fleets skill. For the master session.
 *
 * `/como-vamos [wave-id]` — reads the coordination files that scripts/fleet.sh
 * maintains under .orchestration/wave-<id>/ and prints a live progress report:
 * per-pod task/agent progress, pod handoff readiness (silent-failure guard),
 * Test Pod evidence, and an explicit "needs attention" list (blocked agents,
 * idle capacity with pending work, stale boards, failed tests).
 *
 * Read-only: it never writes coordination files — architects own those.
 */

import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	isBoardStale,
	parseExpectedPods,
	parsePodBoard,
	parseTestRegistry,
} from "./parse.js";
import { buildProgressReport, type WaveSnapshot } from "./progress.js";
import {
	DEFAULT_CONFIG,
	type FleetModelsConfig,
	type FleetRole,
	isFleetRole,
	mergeConfig,
	parseModelRef,
	resolveRoleModels,
} from "./failover-config.js";
import {
	decideFailover,
	type ProviderErrorObservation,
	parseRetryAfter,
} from "./failover-decision.js";

const ORCH_DIR = ".orchestration";

async function pathExists(p: string): Promise<boolean> {
	try {
		await stat(p);
		return true;
	} catch {
		return false;
	}
}

/** Discover wave directories under .orchestration/, newest name last. */
async function listWaves(root: string): Promise<string[]> {
	const dir = join(root, ORCH_DIR);
	if (!(await pathExists(dir))) return [];
	const entries = await readdir(dir, { withFileTypes: true });
	return entries
		.filter((e) => e.isDirectory() && e.name.startsWith("wave-"))
		.map((e) => e.name.replace(/^wave-/, ""))
		.sort();
}

async function readIfExists(p: string): Promise<string | null> {
	try {
		return await readFile(p, "utf8");
	} catch {
		return null;
	}
}

async function loadWaveSnapshot(root: string, waveId: string, now: number): Promise<WaveSnapshot | null> {
	const dir = join(root, ORCH_DIR, `wave-${waveId}`);
	if (!(await pathExists(dir))) return null;

	const files = await readdir(dir);
	const podFiles = files.filter((f) => /^pod-.+-kanban\.md$/.test(f));

	const pods = [];
	const staleBoards: string[] = [];
	for (const f of podFiles.sort()) {
		const podName = f.replace(/^pod-/, "").replace(/-kanban\.md$/, "");
		const md = await readIfExists(join(dir, f));
		if (md === null) continue;
		const board = parsePodBoard(podName, md);
		pods.push(board);
		if (isBoardStale(board.header, now)) staleBoards.push(podName);
	}

	const expectedRaw = await readIfExists(join(dir, "expected-pods"));
	const expectedPods = expectedRaw ? parseExpectedPods(expectedRaw) : [];

	// A pod is "delivered" when its handoff file exists.
	const handoffPods = files
		.filter((f) => /^pod-.+-handoff\.md$/.test(f))
		.map((f) => f.replace(/^pod-/, "").replace(/-handoff\.md$/, ""));

	const regRaw = await readIfExists(join(dir, "test-registry.tsv"));
	const testRegistry = regRaw ? parseTestRegistry(regRaw) : [];

	return { waveId, pods, expectedPods, handoffPods, testRegistry, staleBoards };
}

async function loadFleetConfig(cwd: string): Promise<FleetModelsConfig> {
	for (const p of [join(cwd, ".pi", "fleet-models.json"), join(homedir(), ".pi", "fleet-models.json")]) {
		const raw = await readIfExists(p);
		if (raw !== null) {
			try {
				return mergeConfig(JSON.parse(raw));
			} catch {
				// fall through to defaults on malformed JSON
			}
		}
	}
	return DEFAULT_CONFIG;
}

function currentModelRef(ctx: ExtensionContext): string {
	return ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "";
}

export default function fleetOpsExtension(pi: ExtensionAPI): void {
	// ---- provider-error failover (runs in every session, incl. --no-skills) ----
	let role: FleetRole | undefined;
	let config: FleetModelsConfig = DEFAULT_CONFIG;
	let errors: ProviderErrorObservation[] = [];
	let switchedThisRun = false;

	pi.registerFlag("fleet-role", {
		description: "This session's fleet role (master|supervisor|architect|worker|reviewer|test-worker)",
		type: "string",
	});

	pi.on("session_start", async (_event, ctx) => {
		config = await loadFleetConfig(ctx.cwd);
		const flag = pi.getFlag("fleet-role");
		const envRole = process.env.FLEET_ROLE;
		const candidate = (typeof flag === "string" && flag) || envRole;
		role = isFleetRole(candidate) ? candidate : undefined;
		if (role) ctx.ui.setStatus("fleet-role", ctx.ui.theme.fg("muted", `⛭ ${role}`));
	});

	pi.on("after_provider_response", async (event) => {
		if (!config.onProviderError.statusCodes.includes(event.status)) return;
		errors.push({ status: event.status, retryAfterSeconds: parseRetryAfter(event.headers) });
	});

	pi.on("agent_settled", async (_event, ctx) => {
		const observed = errors;
		errors = [];
		if (observed.length === 0 || switchedThisRun) return;

		const action = decideFailover({
			role,
			roleModels: resolveRoleModels(config, role),
			currentModelRef: currentModelRef(ctx),
			errors: observed,
			policy: config.onProviderError,
		});

		if (action.kind === "none") return;

		if (action.kind === "suggest-retry") {
			ctx.ui.notify(
				`⚠ Fleet: proveedor con errores para ${action.from || "el modelo actual"}. ${action.reason} ` +
					`Sugerencia: reintentar en ~${action.retryAfterSeconds}s.`,
				"warning",
			);
			return;
		}

		if (action.kind === "auto-switch") {
			await applySwitch(ctx, action.to, action.role);
			return;
		}

		// offer-switch: ask the user
		if (!ctx.hasUI) {
			ctx.ui.notify(
				`⚠ Fleet: ${action.from} devolvió error de proveedor (rol ${action.role}). Backup disponible: ${action.to}. Ejecutá /switch-backup para cambiar.`,
				"warning",
			);
			return;
		}
		const choice = await ctx.ui.select(
			`⚠ ${action.from} (rol ${action.role}) da error de proveedor. ¿Qué hago?`,
			[`Switch ahora a backup (${action.to})`, `Reintentar en ${action.retryAfterSeconds}s`, "No hacer nada"],
		);
		if (!choice) return;
		if (choice.startsWith("Switch")) {
			await applySwitch(ctx, action.to, action.role);
		} else if (choice.startsWith("Reintentar")) {
			ctx.ui.notify(`Fleet: reintentá el modelo primario en ~${action.retryAfterSeconds}s (pi ya reintentó 3 veces).`, "info");
		}
	});

	async function applySwitch(ctx: ExtensionContext, to: string, forRole: FleetRole): Promise<void> {
		const ref = parseModelRef(to);
		if (!ref) {
			ctx.ui.notify(`Fleet: backup "${to}" mal formado (esperado "provider/modelId").`, "error");
			return;
		}
		const model = ctx.modelRegistry.find(ref.provider, ref.id);
		if (!model) {
			ctx.ui.notify(`Fleet: backup "${to}" no está en el catálogo de modelos de esta sesión.`, "error");
			return;
		}
		const ok = await pi.setModel(model);
		if (ok) {
			switchedThisRun = true;
			const rm = resolveRoleModels(config, forRole);
			if (rm?.thinking) {
				try {
					pi.setThinkingLevel(rm.thinking as never);
				} catch {
					/* thinking level not applicable to this model */
				}
			}
			ctx.ui.notify(`✓ Fleet: cambiado a backup ${to} (rol ${forRole}).`, "info");
		} else {
			ctx.ui.notify(`Fleet: no se pudo cambiar a ${to} (¿falta API key?).`, "error");
		}
	}

	pi.registerCommand("switch-backup", {
		description: "Cambiar esta sesión al modelo backup de su rol (fleet-models.json)",
		handler: async (_args, ctx) => {
			const rm = resolveRoleModels(config, role);
			if (!role) {
				ctx.ui.notify("Fleet: esta sesión no tiene rol (usá --fleet-role o FLEET_ROLE).", "warning");
				return;
			}
			if (!rm?.backup) {
				ctx.ui.notify(`Fleet: el rol "${role}" no tiene backup configurado.`, "warning");
				return;
			}
			await applySwitch(ctx, rm.backup, role);
		},
	});

	async function handleComoVamos(args: string, ctx: ExtensionCommandContext): Promise<void> {
		const root = ctx.cwd;
		const now = Date.now();

		let waveId = args.trim();
		if (!waveId) {
			const waves = await listWaves(root);
			if (waves.length === 0) {
				ctx.ui.notify(
					"No hay waves activas (.orchestration/ vacío). Scaffolding: skills/orchestrating-agent-fleets → fleet.sh init <wave-id>.",
					"info",
				);
				return;
			}
			if (waves.length === 1) {
				waveId = waves[0];
			} else if (ctx.hasUI) {
				const pick = await ctx.ui.select(`¿Qué wave? (${waves.length} activas)`, waves);
				if (!pick) return;
				waveId = pick;
			} else {
				waveId = waves[waves.length - 1];
			}
		}

		const snap = await loadWaveSnapshot(root, waveId, now);
		if (!snap) {
			ctx.ui.notify(`Wave ${waveId} no encontrada bajo ${ORCH_DIR}/.`, "warning");
			return;
		}

		const report = buildProgressReport(snap);
		const theme = ctx.ui.theme;
		const coloured = report.lines
			.map((line) => {
				if (line.includes("⚠") || line.startsWith("⚠") || line.includes("⛔")) return theme.fg("warning", line);
				if (line.includes("✓")) return theme.fg("success", line);
				if (line.startsWith("■ Pod") || line.startsWith("Wave ")) return theme.fg("accent", line);
				if (/^\s+[▶👁⏱]/.test(line)) return theme.fg("muted", line);
				return line;
			})
			.join("\n");

		ctx.ui.notify(coloured, report.needsAttention ? "warning" : "info");
	}

	pi.registerCommand("como-vamos", {
		description: "Progreso de la wave de agentes (lee .orchestration/wave-<id>/)",
		handler: handleComoVamos,
	});

	// English alias for mixed teams.
	pi.registerCommand("fleet-status", {
		description: "Fleet wave progress (reads .orchestration/wave-<id>/)",
		handler: handleComoVamos,
	});
}
