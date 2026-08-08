import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { TokenSpeedTracker, formatStatus } from "./tracker.js";

const STATUS_KEY = "token-speed";
const OUTPUT_DELTA_TYPES = new Set(["text_delta", "thinking_delta", "toolcall_delta"]);

export default function tokenSpeedExtension(pi: ExtensionAPI): void {
	const tracker = new TokenSpeedTracker();

	function updateStatus(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		const status = formatStatus(tracker.getMetrics(Date.now()));
		ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("muted", status));
	}

	pi.on("session_start", (_event, ctx) => {
		tracker.reset();
		updateStatus(ctx);
	});

	pi.on("before_provider_request", (_event, _ctx) => {
		tracker.beginRequest(Date.now());
	});

	pi.on("message_update", (event, ctx) => {
		const streamEvent = event.assistantMessageEvent;
		if (!OUTPUT_DELTA_TYPES.has(streamEvent.type) || !("delta" in streamEvent)) return;
		tracker.recordDelta(streamEvent.delta, Date.now());
		updateStatus(ctx);
	});

	pi.on("message_end", (event, ctx) => {
		if (event.message.role !== "assistant") return;
		tracker.finishMessage(event.message.usage.output, event.message.stopReason);
		updateStatus(ctx);
	});

	pi.on("agent_end", () => {
		tracker.abandonMessage();
	});

	pi.on("session_shutdown", (_event, ctx) => {
		tracker.reset();
		if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
	});
}
