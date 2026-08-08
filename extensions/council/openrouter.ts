import type { Api, AssistantMessage, Context, Model } from "@earendil-works/pi-ai";

export interface ModelResponse {
	model: string;
	content: string;
	cost: number; // USD
	error?: string;
}

export type ProgressEvent =
	| { type: "start"; model: string }
	| { type: "done"; model: string; ok: boolean; error?: string };

export interface CouncilModelGateway {
	resolve(modelId: string): Model<Api> | undefined;
	complete(model: Model<Api>, context: Context, signal: AbortSignal): Promise<AssistantMessage>;
}

const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 2000;
// Stagger delay between parallel requests to avoid hitting rate limits
const STAGGER_DELAY_MS = 500;

function isRetryable(error: string): boolean {
	const lower = error.toLowerCase();
	return (
		lower.includes("rate") ||
		lower.includes("429") ||
		lower.includes("too many") ||
		lower.includes("timeout") ||
		lower.includes("timed out") ||
		lower.includes("overloaded") ||
		lower.includes("503") ||
		lower.includes("502") ||
		lower.includes("500") ||
		lower.includes("empty response") ||
		lower.includes("server error") ||
		lower.includes("stop reason: error")
	);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal?.aborted) { resolve(); return; }
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
	});
}

async function queryModelOnce(
	modelId: string,
	prompt: string,
	timeoutSecs: number,
	modelGateway: CouncilModelGateway,
	signal?: AbortSignal,
): Promise<ModelResponse> {
	const model = modelGateway.resolve(modelId);
	if (!model) {
		return { model: modelId, content: "", cost: 0, error: `Model not found in pi registry: ${modelId}` };
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(new Error(`Timed out after ${timeoutSecs}s`)), timeoutSecs * 1000);
	const onParentAbort = () => controller.abort();
	signal?.addEventListener("abort", onParentAbort, { once: true });

	try {
		const response = await modelGateway.complete(
			model,
			{
				messages: [
					{ role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() },
				],
			},
			controller.signal,
		);

		const content = response.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("");

		if (!content && response.stopReason) {
			const detail = (response as any).errorMessage ? ` - ${(response as any).errorMessage}` : "";
			return { model: modelId, content: "", cost: response.usage.cost.total, error: `Empty response. Stop reason: ${response.stopReason}${detail}` };
		}

		return { model: modelId, content, cost: response.usage.cost.total };
	} catch (err) {
		return { model: modelId, content: "", cost: 0, error: err instanceof Error ? err.message : String(err) };
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener("abort", onParentAbort);
	}
}

export async function queryModel(
	modelId: string,
	prompt: string,
	timeoutSecs: number,
	modelGateway: CouncilModelGateway,
	signal?: AbortSignal,
): Promise<ModelResponse> {
	let lastResult: ModelResponse | undefined;

	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		if (signal?.aborted) {
			return lastResult ?? { model: modelId, content: "", cost: 0, error: "Aborted" };
		}

		const result = await queryModelOnce(modelId, prompt, timeoutSecs, modelGateway, signal);

		// Success
		if (!result.error) return result;

		lastResult = result;

		// Don't retry non-retryable errors (auth, model not found, etc.)
		if (!isRetryable(result.error)) return result;

		// Don't retry on last attempt
		if (attempt < MAX_RETRIES) {
			const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
			await sleep(delay, signal);
		}
	}

	return lastResult!;
}

export async function queryModelsParallel(
	models: string[],
	prompt: string,
	timeoutSecs: number,
	modelGateway: CouncilModelGateway,
	onProgress?: (event: ProgressEvent) => void,
	signal?: AbortSignal,
): Promise<ModelResponse[]> {
	return Promise.all(
		models.map(async (m, index) => {
			// Stagger requests to avoid simultaneous rate-limit hits
			if (index > 0) {
				await sleep(STAGGER_DELAY_MS * index, signal);
			}
			onProgress?.({ type: "start", model: m });
			const r = await queryModel(m, prompt, timeoutSecs, modelGateway, signal);
			const hasContent = r.content.trim().length > 0;
			if (!hasContent && !r.error) {
				r.error = "Empty response";
			}
			const ok = !r.error;
			onProgress?.({ type: "done", model: m, ok, error: r.error });
			return r;
		}),
	);
}
