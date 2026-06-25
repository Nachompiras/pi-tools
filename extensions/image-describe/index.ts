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

    // Resolve vision model from registry
    const model = ctx.modelRegistry.find(visionModel.provider, visionModel.id);
    if (!model) {
      ctx.ui.notify(`image-describe: vision model ${visionModel.provider}/${visionModel.id} not found in registry`, "error");
      return undefined;
    }

    // Resolve API key
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok || !auth.apiKey) {
      ctx.ui.notify(
        `image-describe: no API key for ${visionModel.provider}/${visionModel.id} — images will be dropped`,
        "error",
      );
      return undefined;
    }

    // Show toast
    const label = imageRefs.length === 1 ? "1 imagen" : `${imageRefs.length} imágenes`;
    ctx.ui.notify(`Describiendo ${label} con ${visionModel.provider}/${visionModel.id}...`, "info");

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
            visionModel,
            auth.apiKey,
            auth.headers,
            ctx.signal,
          );
          descriptionCache.set(fp, description);
        } catch (err) {
          ctx.ui.notify(`image-describe: failed to describe image — ${(err as Error).message}`, "error");
          // Leave block as-is by skipping replacement
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
    description: "Set the vision model used to describe images. Usage: /image-describe-model provider/model-id",
    handler: async (args, ctx) => {
      const input = args?.trim();
      if (!input) {
        ctx.ui.notify(
          `Current vision model: ${visionModel.provider}/${visionModel.id}. Usage: /image-describe-model provider/model-id`,
          "info",
        );
        return;
      }

      const slashIdx = input.indexOf("/");
      if (slashIdx === -1) {
        ctx.ui.notify("image-describe: expected format provider/model-id (e.g. minimax/minimax-m3)", "warning");
        return;
      }

      const provider = input.slice(0, slashIdx);
      const id = input.slice(slashIdx + 1);

      // Validate: model must exist in registry
      const model = ctx.modelRegistry.find(provider, id);
      if (!model) {
        ctx.ui.notify(`image-describe: model ${provider}/${id} not found in registry`, "warning");
        return;
      }

      // Validate: model must support images
      if (!model.input.includes("image")) {
        ctx.ui.notify(`image-describe: ${provider}/${id} does not support image input`, "warning");
        return;
      }

      visionModel = { provider, id };
      ctx.ui.notify(`image-describe: vision model set to ${provider}/${id}`, "info");
    },
  });
}