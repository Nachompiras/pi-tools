# image-describe Extension — Design Spec

**Date:** 2026-06-25
**Status:** Approved

## Summary

A pi extension that automatically intercepts image content in the conversation context and replaces it with text descriptions when the active model does not support vision. Uses a configurable vision model (default: `minimax/minimax-m3`) to generate the descriptions.

## Problem

Many capable LLMs do not support image inputs. When a user attaches an image (e.g. via the `image-label` extension) and the active model is text-only, the image is silently dropped or causes an API error. This extension bridges that gap transparently.

## Architecture

### Hook point: `context` event

The extension intercepts the `context` event, which fires just before each LLM call and provides a deep copy of all messages. This is the right place because:

- `ctx.model` is available to check vision support
- The returned `{ messages }` replaces the payload sent to the LLM
- It does not interfere with session state (non-destructive)
- It runs independently of `image-label.ts` (which operates at input time)

### Flow

```
context event fires
  │
  ├── ctx.model.input.includes("image")?
  │     YES → return undefined (pass-through, no changes)
  │
  └── NO → scan all messages for image content blocks
              │
              ├── no images found → pass-through
              │
              └── images found
                    │
                    ├── check cache (fingerprint = base64 prefix hash)
                    │     HIT  → use cached description
                    │     MISS → call vision model with complete()
                    │
                    ├── show toast "Describiendo N imagen(s) con <model>..."
                    ├── replace image blocks with text blocks (descriptions)
                    └── return { messages: modified }
```

### Error handling

| Case | Behavior |
|------|----------|
| Vision model has no API key | Toast error + return `undefined` (let original messages through — LLM may error, but extension does not block) |
| Vision model call fails / timeout | Toast error + pass original messages through unchanged |
| `/image-describe-model` set to model without vision support | Immediate warning toast, model not changed |
| `/image-describe-model` set to unknown model | Immediate warning toast, model not changed |
| Corrupt/undecodable image | Skip that image block, process others normally |

## Components

### Cache

- `Map<string, string>` keyed by a fingerprint derived from the first 100 chars of base64 data + mime type
- Lives in-memory, cleared on `session_start`
- Prevents re-describing the same image across multiple turns in the same session

### Vision model state

- Default: `minimax/minimax-m3`
- Stored as `{ provider: string; id: string }` in-memory
- Validated on change: must exist in `ctx.modelRegistry` and have `input.includes("image")`

### `/image-describe-model` command

- Accepts `provider/model-id` format (e.g. `anthropic/claude-haiku-4-5`)
- Validates immediately: model must exist and support images
- Shows success toast on change, warning toast on invalid input
- Usage: `/image-describe-model minimax/minimax-m3`

## File layout

```
extensions/
└── image-describe/
    └── index.ts     # Single-file extension
```

Single file is sufficient — no external npm dependencies needed beyond what pi provides.

## Out of scope

- Persisting the configured vision model across sessions (in-memory only)
- Describing images attached via URLs (only base64 inline images handled)
- Showing the description text visibly in the chat (toast only)
- Any UI for browsing/reviewing descriptions
