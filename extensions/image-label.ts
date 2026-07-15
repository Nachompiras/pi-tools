/**
 * image-label extension
 *
 * Detects image paths dragged into the editor and immediately replaces them
 * with [Image N] labels. Loads image data from disk for LLM attachment.
 */
import * as fs from "node:fs";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const MIME_TYPES: Record<string, string> = {
	png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
	gif: "image/gif", webp: "image/webp", bmp: "image/bmp",
	tif: "image/tiff", tiff: "image/tiff",
};

function getMimeType(p: string): string {
	const ext = p.split(".").pop()?.toLowerCase() ?? "";
	return MIME_TYPES[ext] ?? "image/png";
}

const IMAGE_PATH_RE = /(\/[^\n]+\.(?:png|jpg|jpeg|gif|webp|bmp|tiff?))/gi;
/** Matches valid [Image N] labels where N is a positive integer. */
const IMAGE_LABEL_RE = /\[Image (\d+)\]/g;

/** Returns one greater than the highest [Image N] label in the editor text,
 *  or 1 when no such label exists. */
export function nextImageLabelIndex(editorText: string): number {
	let max = 0;
	IMAGE_LABEL_RE.lastIndex = 0;
	for (const match of editorText.matchAll(IMAGE_LABEL_RE)) {
		const n = parseInt(match[1], 10);
		if (n > max) max = n;
	}
	return max + 1;
}

export interface LoadedImage {
	type: "image";
	data: string;
	mimeType: string;
}

/** Production-neutral interface for loading image data.
 *
 * Implementations provide read access to file bytes and MIME type.
 * Production: Node.js fs-based implementation.
 * Testing: plain object implementing the interface. */
export interface ImageDataSource {
	readFile(path: string): Buffer | null;
	getMimeType(path: string): string;
}

/** Real Node.js filesystem data source — used by the live extension. */
const realFsDataSource: ImageDataSource = {
	readFile: (path: string) => {
		try { return fs.readFileSync(path); } catch { return null; }
	},
	getMimeType: (path: string) => getMimeType(path),
};

/** Applies [Image N] labels to cleaned terminal input, reads each image file,
 *  and returns the updated editor text plus the loaded image objects.
 *
 *  The label index is derived from `editorText` internally using
 *  `nextImageLabelIndex`, ensuring labels continue the visible sequence
 *  across sequential drops. */
export function applyImageLabels(
	cleanedInput: string,
	dataSource: ImageDataSource,
	editorText: string,
): { text: string; images: LoadedImage[] } {
	IMAGE_PATH_RE.lastIndex = 0;
	const rawMatches = [...cleanedInput.matchAll(IMAGE_PATH_RE)].map(m => m[1]);
	if (rawMatches.length === 0) return { text: cleanedInput, images: [] };

	const images: LoadedImage[] = [];
	let cleanedText = cleanedInput;
	const start = nextImageLabelIndex(editorText);
	let index = start;

	for (const raw of rawMatches) {
		const realPath = raw.replace(/\\(.)/g, "$1").trim();
		const buf = dataSource.readFile(realPath);
		if (!buf) continue;  // Can't read — leave path as-is, no label consumed

		images.push({ type: "image", data: buf.toString("base64"), mimeType: dataSource.getMimeType(realPath) });
		const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		cleanedText = cleanedText.replace(new RegExp(escaped, "g"), `[Image ${index}]`);
		index++;
	}

	if (images.length === 0) return { text: cleanedInput, images: [] };

	return { text: cleanedText, images };
}

/** Result shape returned by the terminal-input and input handlers. */
export type TransformResult =
	| { action: "transform"; text: string; images: LoadedImage[] }
	| { action: "continue" };

/** Transforms the `input` event by appending all accumulated pending images to
 *  the Pi-supplied event.images, then clears pending.
 *
 *  Pi-provided images (from pasted/dragged UI images) appear first, matching
 *  Pi 0.80.7 `input` transform semantics. */
export function transformImagesOnSubmit(
	pendingImages: LoadedImage[],
	event: { text: string; images?: LoadedImage[] },
): TransformResult {
	if (pendingImages.length === 0) return { action: "continue" };
	const images = [...(event.images ?? []), ...pendingImages];
	pendingImages.length = 0;
	return { action: "transform", text: event.text, images };
}

export default function (pi: ExtensionAPI) {
	const pendingImages: LoadedImage[] = [];
	let settingEditor = false;
	let unregister: (() => void) | null = null;

	// Register on every session_start (startup, reload, new, fork)
	pi.on("session_start", (_event, ctx) => {
		pendingImages.length = 0;

		// Unregister previous handler before re-registering
		unregister?.();

		unregister = ctx.ui.onTerminalInput((data) => {
			if (settingEditor) return undefined;

			// Strip bracketed paste markers (ESC[200~ ... ESC[201~)
			const cleaned = data
				.replace(/\x1b\[200~/g, "")
				.replace(/\x1b\[201~/g, "")
				.replace(/\[200~/g, "")
				.replace(/\[201~/g, "");

			// Only process chunks that look like file paths
			if (!cleaned.includes("/") || cleaned.length < 10) return undefined;

			const currentText = ctx.ui.getEditorText();
			const { text: relabeled, images } = applyImageLabels(
				cleaned,
				realFsDataSource,
				currentText,
			);
			if (images.length === 0) return undefined;

			const prefix = currentText ? currentText + " " : "";
			settingEditor = true;
			ctx.ui.setEditorText((prefix + relabeled.trim()).trim());
			settingEditor = false;

			// Append — do NOT replace — so all prior drops remain attached
			pendingImages.push(...images);

			return { consume: true };
		});
	});

	pi.on("input", async (event, _ctx) => {
		if (event.source === "extension") return { action: "continue" };
		return transformImagesOnSubmit(pendingImages, { text: event.text, images: event.images });
	});
}
