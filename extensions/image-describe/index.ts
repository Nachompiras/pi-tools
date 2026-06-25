/**
 * image-describe extension
 *
 * Intercepts image content blocks in the LLM context and replaces them
 * with text descriptions when the active model does not support vision.
 * Uses a configurable vision model (default: minimax/minimax-m3).
 *
 * Features:
 * - Automatic pass-through when active model supports vision
 * - In-session description cache (cleared on session_start)
 * - Image compression via sharp (downscale + JPEG, falls back to raw if not installed)
 * - Config persisted to ~/.pi/agent/image-describe.json
 * - Animated spinner in footer while describing
 * - /image-describe-model to change vision model at runtime
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { complete, type UserMessage } from "@earendil-works/pi-ai/compat";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CONFIG_PATH = join(getAgentDir(), "image-describe.json");

interface ImageDescribeConfig {
  /** Substring query used to find the vision model in the registry */
  visionModelQuery: string;
  /** Max image dimension (px) before downscaling. Default: 1568 */
  maxDimension: number;
  /** JPEG quality 1-100 used when converting. Default: 85 */
  jpegQuality: number;
}

const DEFAULT_CONFIG: ImageDescribeConfig = {
  visionModelQuery: "minimax/minimax-m3",
  maxDimension: 1568,
  jpegQuality: 85,
};

function loadConfig(): ImageDescribeConfig {
  try {
    if (!existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG };
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    return {
      visionModelQuery: raw.visionModelQuery ?? DEFAULT_CONFIG.visionModelQuery,
      maxDimension: raw.maxDimension ?? DEFAULT_CONFIG.maxDimension,
      jpegQuality: raw.jpegQuality ?? DEFAULT_CONFIG.jpegQuality,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(cfg: ImageDescribeConfig) {
  try {
    mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  } catch { /* already exists */ }
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Fingerprint → description cache, cleared each session */
const descriptionCache = new Map<string, string>();

let config = loadConfig();

// ---------------------------------------------------------------------------
// Image compression
// ---------------------------------------------------------------------------

/**
 * Compress an image buffer before sending to the vision model.
 * - Downscales to maxDimension if needed
 * - Strips alpha channel
 * - Converts to JPEG
 * Falls back to raw bytes if sharp is not installed.
 */
async function compressImage(
  data: string,
  mimeType: string,
): Promise<{ data: string; mimeType: string }> {
  try {
    const sharp = (await import("sharp")).default;
    const buffer = Buffer.from(data, "base64");
    let pipeline = sharp(buffer);
    const meta = await pipeline.metadata();

    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (w > config.maxDimension || h > config.maxDimension) {
      pipeline = pipeline.resize(config.maxDimension, config.maxDimension, {
        fit: "inside",
        withoutEnlargement: true,
      });
    }

    if (meta.hasAlpha || meta.channels === 4) {
      pipeline = pipeline.removeAlpha();
    }

    // GIFs can't be re-encoded to JPEG reliably
    if (mimeType === "image/gif") {
      const out = await pipeline.toBuffer();
      return { data: out.toString("base64"), mimeType };
    }

    const out = await pipeline.jpeg({ quality: config.jpegQuality }).toBuffer();
    return { data: out.toString("base64"), mimeType: "image/jpeg" };
  } catch {
    // sharp not installed or decode failed — send as-is
    return { data, mimeType };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive a short fingerprint from an image block.
 * Uses first 100 chars of base64 data + mimeType — good enough for cache keying.
 */
function fingerprint(data: string, mimeType: string): string {
  return `${mimeType}:${data.slice(0, 100)}`;
}

/**
 * Find a vision-capable model by searching for `query` as a substring of
 * model IDs across all providers. Tries exact provider/id first, then falls
 * back to substring search — handles OpenRouter where provider="openrouter"
 * but model id contains the original "provider/model" string.
 */
function findVisionModel(
  registry: { getAll(): Array<{ id: string; provider: string; input: string[] }>; find(p: string, id: string): any },
  query: string,
) {
  const slash = query.indexOf("/");
  if (slash !== -1) {
    const exact = registry.find(query.slice(0, slash), query.slice(slash + 1));
    if (exact) return exact;
  }
  const all = registry.getAll();
  return all.find(
    (m) => m.input.includes("image") && m.id.toLowerCase().includes(query.toLowerCase()),
  );
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

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

const SPINNER_FRAMES = ["◐", "◓", "◑", "◒"];

export default function (pi: ExtensionAPI) {
  // Reload config and clear cache on every session start
  pi.on("session_start", () => {
    config = loadConfig();
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
    const model = findVisionModel(ctx.modelRegistry, config.visionModelQuery);
    if (!model) {
      ctx.ui.notify(`image-describe: no vision model matching "${config.visionModelQuery}" found in registry`, "error");
      return undefined;
    }

    // Resolve auth (API key or headers — OpenRouter delivers auth via headers)
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok) {
      ctx.ui.notify(`image-describe: auth failed for ${model.provider}/${model.id} — ${auth.error}`, "error");
      return undefined;
    }

    // Deep-clone messages so we can mutate safely
    const messages = JSON.parse(JSON.stringify(event.messages));

    // Fingerprint on raw data — stable across turns since message history doesn't change.
    // Separate cache hits (replace immediately, no API call) from misses (need description).
    type PendingRef = ImageRef & { fp: string };
    const pending: PendingRef[] = [];

    for (const ref of imageRefs) {
      const fp = fingerprint(ref.data, ref.mimeType);
      const cached = descriptionCache.get(fp);
      if (cached) {
        // Already described in this session — replace silently, no toast needed
        (messages[ref.msgIndex] as any).content[ref.blockIndex] = {
          type: "text",
          text: `[Image description: ${cached}]`,
        };
      } else {
        pending.push({ ...ref, fp });
      }
    }

    // All images were cached — return early with no toast or spinner
    if (pending.length === 0) return { messages };

    // Only show toast + spinner for images that actually need describing
    const label = pending.length === 1 ? "1 image" : `${pending.length} images`;
    ctx.ui.notify(`Describing ${label} with ${model.provider}/${model.id}...`, "info");

    let spinnerIdx = 0;
    const spinner = setInterval(() => {
      spinnerIdx = (spinnerIdx + 1) % SPINNER_FRAMES.length;
      ctx.ui.setStatus("image-describe", `${SPINNER_FRAMES[spinnerIdx]} ${model.provider}/${model.id}`);
    }, 150);

    try {
      for (const ref of pending) {
        // Compress only on cache miss
        const compressed = await compressImage(ref.data, ref.mimeType);
        let description: string;
        try {
          description = await describeImage(
            compressed.data,
            compressed.mimeType,
            model,
            auth.apiKey ?? "",
            auth.headers,
            ctx.signal,
          );
          descriptionCache.set(ref.fp, description);
        } catch (err) {
          ctx.ui.notify(`image-describe: failed to describe image — ${(err as Error).message}`, "error");
          // Replace with a text fallback so the non-vision model doesn't receive a raw image block
          (messages[ref.msgIndex] as any).content[ref.blockIndex] = {
            type: "text",
            text: `[Image: could not be described — ${(err as Error).message}]`,
          };
          continue;
        }

        // Replace image block with text block
        (messages[ref.msgIndex] as any).content[ref.blockIndex] = {
          type: "text",
          text: `[Image description: ${description}]`,
        };
      }
    } finally {
      clearInterval(spinner);
      ctx.ui.setStatus("image-describe", undefined);
    }

    return { messages };
  });

  // ---------------------------------------------------------------------------
  // /image-describe-model command
  // ---------------------------------------------------------------------------

  pi.registerCommand("image-describe-model", {
    description: "Set the vision model query string for image descriptions. Usage: /image-describe-model <query> (e.g. minimax/minimax-m3)",
    handler: async (args, ctx) => {
      const input = args?.trim();
      if (!input) {
        const current = findVisionModel(ctx.modelRegistry, config.visionModelQuery);
        const resolved = current
          ? ` (resolved: ${current.provider}/${current.id})`
          : " (not found in registry)";
        ctx.ui.notify(
          `Current query: "${config.visionModelQuery}"${resolved}. Usage: /image-describe-model <query>`,
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

      config.visionModelQuery = input;
      saveConfig(config);
      ctx.ui.notify(
        `image-describe: vision model query set to "${input}" (resolved: ${found.provider}/${found.id})`,
        "info",
      );
    },
  });
}
