const LIVE_WINDOW_MS = 5_000;
const MIN_LIVE_DURATION_MS = 250;
const COMPLETED_STOP_REASONS = new Set(["stop", "length", "toolUse"]);

interface TokenSample {
	at: number;
	tokens: number;
}

export interface TokenSpeedMetrics {
	tps: number | undefined;
	averageTps: number | undefined;
	averageTtftMs: number | undefined;
}

export function formatRate(value: number | undefined): string {
	if (value === undefined || !Number.isFinite(value) || value <= 0) return "-";
	if (value >= 100) return Math.round(value).toString();
	if (value >= 10) return value.toFixed(1);
	return value.toFixed(2);
}

function formatTtft(valueMs: number | undefined): string {
	if (valueMs === undefined || !Number.isFinite(valueMs) || valueMs < 0) return "-";
	return `${(valueMs / 1_000).toFixed(1)}s`;
}

export function formatStatus(metrics: TokenSpeedMetrics): string {
	return `TPS ${formatRate(metrics.tps)} | AVG ${formatRate(metrics.averageTps)} | TTFT ${formatTtft(metrics.averageTtftMs)}`;
}

export class TokenSpeedTracker {
	private requestStartAt: number | undefined;
	private firstOutputAt: number | undefined;
	private lastOutputAt: number | undefined;
	private samples: TokenSample[] = [];
	private lastCompletedTps: number | undefined;
	private totalOutputTokens = 0;
	private totalDecodeDurationMs = 0;
	private totalTtftMs = 0;
	private ttftCount = 0;

	reset(): void {
		this.clearCurrentMessage();
		this.lastCompletedTps = undefined;
		this.totalOutputTokens = 0;
		this.totalDecodeDurationMs = 0;
		this.totalTtftMs = 0;
		this.ttftCount = 0;
	}

	beginRequest(at: number): void {
		this.clearCurrentMessage();
		if (Number.isFinite(at)) this.requestStartAt = at;
	}

	recordDelta(delta: string, at: number): void {
		if (!delta || !Number.isFinite(at)) return;

		this.firstOutputAt ??= at;
		this.lastOutputAt = at;
		const cutoff = at - LIVE_WINDOW_MS;
		this.samples = this.samples.filter((sample) => sample.at >= cutoff && sample.at <= at);
		this.samples.push({
			at,
			tokens: Math.max(1, Math.ceil(Buffer.byteLength(delta, "utf8") / 5)),
		});
	}

	finishMessage(outputTokens: number, stopReason: string): void {
		if (COMPLETED_STOP_REASONS.has(stopReason) && Number.isFinite(outputTokens) && outputTokens > 0) {
			if (this.firstOutputAt !== undefined && this.lastOutputAt !== undefined) {
				const durationMs = this.lastOutputAt - this.firstOutputAt;
				if (durationMs > 0) {
					this.lastCompletedTps = outputTokens / (durationMs / 1_000);
					this.totalOutputTokens += outputTokens;
					this.totalDecodeDurationMs += durationMs;
				}
			}

			if (this.requestStartAt !== undefined && this.firstOutputAt !== undefined) {
				const ttftMs = this.firstOutputAt - this.requestStartAt;
				if (ttftMs >= 0) {
					this.totalTtftMs += ttftMs;
					this.ttftCount++;
				}
			}
		}

		this.clearCurrentMessage();
	}

	abandonMessage(): void {
		this.clearCurrentMessage();
	}

	getMetrics(at: number): TokenSpeedMetrics {
		const liveTps = this.firstOutputAt === undefined ? undefined : this.computeLiveTps(at);
		return {
			tps: liveTps ?? this.lastCompletedTps,
			averageTps:
				this.totalOutputTokens > 0 && this.totalDecodeDurationMs > 0
					? this.totalOutputTokens / (this.totalDecodeDurationMs / 1_000)
					: undefined,
			averageTtftMs: this.ttftCount > 0 ? this.totalTtftMs / this.ttftCount : undefined,
		};
	}

	private computeLiveTps(at: number): number | undefined {
		if (!Number.isFinite(at)) return undefined;

		const cutoff = at - LIVE_WINDOW_MS;
		const samples = this.samples.filter((sample) => sample.at >= cutoff && sample.at <= at);
		if (samples.length === 0) return undefined;

		const tokens = samples.reduce((sum, sample) => sum + sample.tokens, 0);
		const durationMs = Math.min(
			LIVE_WINDOW_MS,
			Math.max(at - samples[0].at, MIN_LIVE_DURATION_MS),
		);
		return tokens / (durationMs / 1_000);
	}

	private clearCurrentMessage(): void {
		this.requestStartAt = undefined;
		this.firstOutputAt = undefined;
		this.lastOutputAt = undefined;
		this.samples = [];
	}
}
