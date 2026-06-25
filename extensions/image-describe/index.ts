/**
 * image-describe extension
 *
 * Intercepts image content blocks in the LLM context and replaces them
 * with text descriptions when the active model does not support vision.
 * Uses a configurable vision model (default: minimax/minimax-m3).
 */
import { complete, type UserMessage } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// --- State ---

/** Fingerprint → description cache, cleared each session */
const descriptionCache = new Map<string, string>();

/** Currently configured vision model */
let visionModel = { provider: "minimax", id: "minimax-m3" };

/**
 * Derive a short fingerprint from an image block.
 * Uses first 100 chars of base64 data + mimeType — good enough for cache keying.
 */
function fingerprint(data: string, mimeType: string): string {
  return `${mimeType}:${data.slice(0, 100)}`;
}

export default function (pi: ExtensionAPI) {
  // Clear cache on every session start
  pi.on("session_start", () => {
    descriptionCache.clear();
  });
}