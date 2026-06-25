# image-describe Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a pi extension that automatically replaces image content blocks with text descriptions when the active model does not support vision, using a configurable vision model (default: `minimax/minimax-m3`).

**Architecture:** Hook into the `context` event to intercept all messages before they're sent to the LLM. Check if the active model supports images via `ctx.model.input.includes("image")`; if not, find all image content blocks, describe them using `complete()` from `@earendil-works/pi-ai/compat`, and replace those blocks with text. Cache descriptions in-memory per session to avoid re-describing the same image.

**Tech Stack:** TypeScript, `@earendil-works/pi-coding-agent` (ExtensionAPI, context event), `@earendil-works/pi-ai/compat` (complete, UserMessage)

---

## File Structure

| File | Responsibility |
|------|----------------|
| `extensions/image-describe/index.ts` | Full extension: state, context hook, command, cache |

Single file — no external npm dependencies needed.

---

### Task 1: Scaffold the extension file

**Files:**
- Create: `extensions/image-describe/index.ts`

- [ ] **Step 1: Create the directory and stub file**

```bash
mkdir -p extensions/image-describe
```

Create `extensions/image-describe/index.ts` with this content:

```typescript
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
```

- [ ] **Step 2: Verify the file loads without errors**

```bash
pi -e ./extensions/image-describe/index.ts --print "hello"
```

Expected: pi responds normally, no extension load error.

- [ ] **Step 3: Commit**

```bash
git add extensions/image-describe/index.ts
git commit -m "feat(image-describe): scaffold extension with state and cache"
```

---

### Task 2: Add the `context` hook — detect images and pass-through when model supports vision

**Files:**
- Modify: `extensions/image-describe/index.ts`

- [ ] **Step 1: Add the context event hook inside the default export function**

Replace the `export default function` block with:

```typescript
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

    // Count images across all messages
    let imageCount = 0;
    for (const msg of event.messages) {
      if ("content" in msg && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (typeof block === "object" && block !== null && (block as any).type === "image") {
            imageCount++;
          }
        }
      }
    }

    // No images found — nothing to do
    if (imageCount === 0) {
      return undefined;
    }

    // (description logic comes in Task 3)
    return undefined;
  });
}
```

- [ ] **Step 2: Verify the hook loads without errors**

```bash
pi -e ./extensions/image-describe/index.ts --print "hello"
```

Expected: pi responds normally.

- [ ] **Step 3: Commit**

```bash
git add extensions/image-describe/index.ts
git commit -m "feat(image-describe): add context hook with vision model pass-through check"
```

---

### Task 3: Implement image description with `complete()`, cache, and toast

**Files:**
- Modify: `extensions/image-describe/index.ts`

This task adds the `describeImage` helper and wires it into the `context` hook.

- [ ] **Step 1: Add the `describeImage` helper above the `export default` function**

```typescript
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
```

- [ ] **Step 2: Replace the `context` hook body with full description logic**

Replace the context hook (from `pi.on("context"` to its closing `});`) with:

```typescript
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
```

- [ ] **Step 3: Verify the file compiles (no syntax errors)**

```bash
pi -e ./extensions/image-describe/index.ts --print "hello"
```

Expected: pi responds normally.

- [ ] **Step 4: Commit**

```bash
git add extensions/image-describe/index.ts
git commit -m "feat(image-describe): describe images with vision model, cache, toast notification"
```

---

### Task 4: Add `/image-describe-model` command

**Files:**
- Modify: `extensions/image-describe/index.ts`

- [ ] **Step 1: Register the command inside the `export default` function, after the `context` hook**

```typescript
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
```

- [ ] **Step 2: Test the command parses correctly**

```bash
pi -e ./extensions/image-describe/index.ts --print "/image-describe-model"
```

Expected: pi responds and the extension shows the current model notification (no crash).

- [ ] **Step 3: Commit**

```bash
git add extensions/image-describe/index.ts
git commit -m "feat(image-describe): add /image-describe-model command with validation"
```

---

### Task 5: Manual end-to-end verification

**Files:** none (verification only)

This task verifies the full extension works as intended with a real model.

- [ ] **Step 1: Start pi with the extension and a text-only model (e.g. deepseek-r1)**

```bash
pi -e ./extensions/image-describe/index.ts
# Then in the pi TUI, switch to a text-only model with /model
```

- [ ] **Step 2: Drag an image into the chat using image-label**

Drag any `.png` or `.jpg` file into the editor (or type an absolute path and confirm it gets replaced with `[Image 1]`). Submit with a prompt like "What do you see?".

Expected:
- Toast appears: "Describiendo 1 imagen con minimax/minimax-m3..."
- The LLM receives a text description instead of raw image data
- The LLM responds based on the description

- [ ] **Step 3: Test with a model that supports vision (e.g. claude-sonnet)**

Switch to a vision-capable model with `/model`. Drag the same image and submit.

Expected:
- No toast appears
- Image passes through unchanged to the LLM
- LLM responds directly from the image

- [ ] **Step 4: Test the `/image-describe-model` command**

```
/image-describe-model anthropic/claude-haiku-4-5
```

Expected: Toast confirms the change.

```
/image-describe-model bogus/nonexistent
```

Expected: Warning toast, model unchanged.

```
/image-describe-model
```

Expected: Info toast showing current model.

- [ ] **Step 5: Commit final verification note**

```bash
git commit --allow-empty -m "chore(image-describe): manual verification passed"
```
