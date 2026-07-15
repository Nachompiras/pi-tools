# Image Label Accumulation Design

## Purpose

Correct `extensions/image-label.ts` so sequential image drops within one unsent editor message receive distinct labels and every dropped image is attached when the message is submitted.

## Current Problem

Each terminal-input event initializes its label index at `0`. Three separate drops therefore each render as `[Image 1]`. In addition, each drop clears `pendingImages`, retaining only the most recent drop for the eventual `input` event.

## Selected Approach

Derive the next label number from the editor text immediately before processing a drop, and append newly loaded images to the pending attachment list.

This is preferred over a standalone mutable counter because the editor text is the visible source of truth: deleting or manually editing labels cannot leave a counter out of sync.

## Behavior

- A drop containing one or more readable image paths replaces each path with sequential labels beginning after the highest existing `[Image N]` label in the editor.
- Separate drops before submission continue the visible sequence. For example, three one-image drops result in `[Image 1] [Image 2] [Image 3]`.
- The extension retains images from all successful drops until Pi emits the corresponding user `input` event.
- On that event, the extension appends every retained image to `event.images`, clears the retained list, and leaves the transformed text unchanged.
- Existing attachments supplied by Pi remain present; the extension only appends its own loaded images.
- Invalid or unreadable paths remain in the editor and do not consume a label number or attachment slot.
- Session start continues to clear pending state, so attachments cannot leak into a new, resumed, forked, or reloaded session.

## Testing

Extract or isolate the label-number and pending-image behavior sufficiently to test it without a live terminal. Add a regression test that models three sequential one-image drops and asserts the resulting labels are distinct and all three attachments are forwarded exactly once on submission.

## Scope

No custom visual renderer is added. Pi 0.80.7 already natively supports pasting and dragging images as attachments, but its native UI intentionally uses file paths rather than numbered placeholders. This extension remains responsible only for the cleaner `[Image N]` representation when users drop path-bearing terminal input.
