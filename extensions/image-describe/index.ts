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

/**
 * Currently configured vision model search string.
 * Matched against model IDs using substring search across all registered models.
 * Supports both exact provider/id format (e.g. "minimax/minimax-m3") and
 * bare id strings (e.g. "minimax-m3") for OpenRouter-style registrations.
 */
let visionModelQuery = "minimax/minimax-m3";

/**
 * Find a vision-capable model by searching for `query` as a substring of model IDs
 * across all providers. Returns the first match whose `input` includes "image".
 * Falls back to exact provider+id lookup for backwards compatibility.
 */
function findVisionModel(registry: { getAll(): Array<{ id: string; provider: string; input: string[] }>; find(p: string, id: string): any }, query: string) {
  // Try exact provider/id first
  const slash = query.indexOf("/");
  if (slash !== -1) {
    const exact = registry.find(query.slice(0, slash), query.slice(slash + 1));
    if (exact) return exact;
  }

  // Fall back to substring search across all models (handles OpenRouter where
  // provider="openrouter" but model id contains the original "provider/model" string)
  const all = registry.getAll();
  return all.find(
    (m) => m.input.includes("image") && m.id.toLowerCase().includes(query.toLowerCase()),
  );
}

/**
 * Derive a short fingerprint from an image block.
 * Uses first 100 chars of base64 data + mimeType — good enough for cache keying.
 */
function fingerprint(data: string, mimeType: string): string {
  return `${mimeType}:${data.slice(0, 100)}`;
}

/**
 * Call the vision model to describe a single image.
 * Returns the description string, or throws on failure.
 */
async function describeImage(
  data: string,
  mimeType: string,
  model: { provider: string; id: string },
  apiKey: string,
  headers: Record<string, string> | undefined,
  signal: AbortSignal | undefined,
): Promise<string> {
  const userMessage: UserMessage = {
    role: "user",
    content: [
      { type: "image", data, mimeType },
      { type: "text", text: "Describe this image in detail. Be concise but thorough. Focus on content relevant to a software development context if applicable." },
    ] as any,
    timestamp: Date.now(),
  };

  const response = await complete(
    model as any,
    { messages: [userMessage] },
    { apiKey, headers, signal },
  );

  if (response.stopReason === "aborted") {
    throw new Error("Vision model call aborted");
  }

  return response.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

export default function (pi: ExtensionAPI) {
  // Clear cache on every session start
  pi.on("session_start", () => {
    descriptionCache.clear();
  });

  // Intercept messages before they reach the LLM
  pi.on("context", async (event, ctx) => {
    // If the active model supports images, do nothing
    if (!ctx.model || ctx.model.input.includes("image")) {
      return undefined;
    }

    // Collect image positions: { msgIndex, blockIndex, data, mimeType }
    type ImageRef = { msgIndex: number; blockIndex: number; data: string; mimeType: string };
    const imageRefs: ImageRef[] = [];

    for (let mi = 0; mi < event.messages.length; mi++) {
      const msg = event.messages[mi];
      if (!("content" in msg) || !Array.isArray(msg.content)) continue;
      for (let bi = 0; bi < msg.content.length; bi++) {
        const block = msg.content[bi] as any;
        if (block?.type === "image" && typeof block.data === "string") {
          imageRefs.push({ msgIndex: mi, blockIndex: bi, data: block.data, mimeType: block.mimeType ?? "image/png" });
        }
      }
    }

    if (imageRefs.length === 0) return undefined;

    // Resolve vision model from registry (substring search to support OpenRouter)
    const model = findVisionModel(ctx.modelRegistry, visionModelQuery);
    if (!model) {
      ctx.ui.notify(`image-describe: no vision model matching "${visionModelQuery}" found in registry`, "error");
      return undefined;
    }

    // Resolve auth (API key or headers — OpenRouter delivers auth via headers, not apiKey)
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok) {
      ctx.ui.notify(
        `image-describe: auth failed for ${model.provider}/${model.id} — ${auth.error}`,
        "error",
      );
      return undefined;
    }

    // Show toast
    const label = imageRefs.length === 1 ? "1 image" : `${imageRefs.length} images`;
    ctx.ui.notify(`Describing ${label} with ${model.provider}/${model.id}...`, "info");

    // Deep-clone messages so we can mutate safely
    const messages = JSON.parse(JSON.stringify(event.messages));

    // Describe each image (use cache when possible)
    for (const ref of imageRefs) {
      const fp = fingerprint(ref.data, ref.mimeType);
      let description = descriptionCache.get(fp);

      if (!description) {
        try {
          description = await describeImage(
            ref.data,
            ref.mimeType,
            model,
            auth.apiKey ?? "",
            auth.headers,
            ctx.signal,
          );
          descriptionCache.set(fp, description);
        } catch (err) {
          ctx.ui.notify(`image-describe: failed to describe image — ${(err as Error).message}`, "error");
          // Replace with a text fallback so the non-vision model doesn't receive a raw image block
          (messages[ref.msgIndex] as any).content[ref.blockIndex] = {
            type: "text",
            text: `[Image: could not be described — ${(err as Error).message}]`,
          };
          continue;
        }
      }

      // Replace image block with text block
      (messages[ref.msgIndex] as any).content[ref.blockIndex] = {
        type: "text",
        text: `[Image description: ${description}]`,
      };
    }

    return { messages };
  });

  pi.registerCommand("image-describe-model", {
    description: "Set the vision model query string for image descriptions. Usage: /image-describe-model <query> (e.g. minimax/minimax-m3)",
    handler: async (args, ctx) => {
      const input = args?.trim();
      if (!input) {
        const current = findVisionModel(ctx.modelRegistry, visionModelQuery);
        const resolved = current ? ` (resolved: ${current.provider}/${current.id})` : " (not found in registry)";
        ctx.ui.notify(
          `Current query: "${visionModelQuery}"${resolved}. Usage: /image-describe-model <query>`,
          "info",
        );
        return;
      }

      // Validate: at least one vision-capable model must match
      const found = findVisionModel(ctx.modelRegistry, input);
      if (!found) {
        ctx.ui.notify(`image-describe: no vision model matching "${input}" found in registry`, "warning");
        return;
      }

      visionModelQuery = input;
      ctx.ui.notify(`image-describe: vision model query set to "${input}" (resolved: ${found.provider}/${found.id})`, "info");
    },
  });
}