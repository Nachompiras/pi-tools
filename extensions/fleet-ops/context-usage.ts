/**
 * Read each agent's context usage from its pi session .jsonl.
 *
 * The monitor's job is team health. A silently over-full context is as dangerous
 * as a stalled agent: the agent starts to lose the thread, forget its contract,
 * and degrade — usually with no error. Herdr's `agent list` gives each agent's
 * session file path (`agent_session.value`); the last `usage.totalTokens` in that
 * file, over the model's contextWindow, is the context percentage.
 *
 * Parsing is pure/streaming-friendly; the extension does the file I/O and the
 * herdr lookup and passes the raw text in.
 */

export interface ContextReading {
	agent: string; // agent/session name
	modelId?: string; // provider/modelId from the session, if present
	totalTokens: number;
	contextWindow: number;
	percent: number; // 0..100, rounded
}

export interface ContextThresholds {
	warn: number; // e.g. 70
	high: number; // e.g. 85
}

export const DEFAULT_CONTEXT_THRESHOLDS: ContextThresholds = { warn: 70, high: 85 };

/**
 * Extract the last `usage.totalTokens` and the model id from a session .jsonl.
 * Scans line-by-line; tolerant of malformed lines. Returns null when no usage
 * is present yet (fresh session).
 */
export function parseSessionUsage(jsonl: string): { totalTokens: number; modelId?: string } | null {
	let lastTotal: number | null = null;
	let modelId: string | undefined;

	for (const line of jsonl.split("\n")) {
		const s = line.trim();
		if (!s) continue;
		let obj: unknown;
		try {
			obj = JSON.parse(s);
		} catch {
			continue;
		}
		if (obj && typeof obj === "object") {
			const o = obj as Record<string, unknown>;
			if (o.type === "model_change" && typeof o.modelId === "string") {
				const provider = typeof o.provider === "string" ? `${o.provider}/` : "";
				modelId = `${provider}${o.modelId}`;
			}
			const total = findTotalTokens(o);
			if (total !== null) lastTotal = total;
		}
	}
	if (lastTotal === null) return null;
	return { totalTokens: lastTotal, modelId };
}

/** Depth-limited search for a `usage.totalTokens` number anywhere in the entry. */
function findTotalTokens(x: unknown, depth = 0): number | null {
	if (depth > 6 || x === null || typeof x !== "object") return null;
	const o = x as Record<string, unknown>;
	const usage = o.usage;
	if (usage && typeof usage === "object") {
		const t = (usage as Record<string, unknown>).totalTokens;
		if (typeof t === "number") return t;
	}
	for (const v of Object.values(o)) {
		if (v && typeof v === "object") {
			const r = findTotalTokens(v, depth + 1);
			if (r !== null) return r;
		}
	}
	return null;
}

export function computeReading(
	agent: string,
	usage: { totalTokens: number; modelId?: string } | null,
	contextWindow: number,
): ContextReading | null {
	if (!usage || contextWindow <= 0) return null;
	const percent = Math.round((usage.totalTokens / contextWindow) * 100);
	return { agent, modelId: usage.modelId, totalTokens: usage.totalTokens, contextWindow, percent };
}

/** Readings at/above the warn threshold, worst first. */
export function contextAlerts(readings: ContextReading[], thresholds: ContextThresholds): ContextReading[] {
	return readings.filter((r) => r.percent >= thresholds.warn).sort((a, b) => b.percent - a.percent);
}

function fmtTokens(n: number): string {
	return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

/** Reminder body for context pressure. Empty when nothing crosses `warn`. */
export function formatContextMessage(readings: ContextReading[], thresholds: ContextThresholds): string {
	const alerts = contextAlerts(readings, thresholds);
	if (alerts.length === 0) return "";
	const lines: string[] = [];
	lines.push(`🧠 Monitor: contexto alto en ${alerts.length} agente(s) — pedí checkpoint + reset antes de que se degraden.`);
	for (const r of alerts) {
		const level = r.percent >= thresholds.high ? "ALTO" : "vigilar";
		lines.push(
			`  • ${r.agent} ${r.percent}% (${fmtTokens(r.totalTokens)}/${fmtTokens(r.contextWindow)}) [${level}]` +
				(r.modelId ? ` · ${r.modelId}` : ""),
		);
	}
	return lines.join("\n");
}

/** Stable signature so an unchanged context-alert set isn't re-announced. */
export function contextSignature(readings: ContextReading[], thresholds: ContextThresholds): string {
	// bucket percent to 5% steps so tiny drift doesn't re-fire, but crossing high does
	return contextAlerts(readings, thresholds)
		.map((r) => `${r.agent}:${Math.floor(r.percent / 5) * 5}:${r.percent >= thresholds.high ? "H" : "W"}`)
		.sort()
		.join(",");
}
