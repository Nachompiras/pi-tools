/**
 * image-label regression tests — verifies accumulated [Image N] labels
 * and one-time attachment forwarding across sequential drops.
 *
 * Run with: npx tsx tests/image-label.test.ts
 */
import {
  nextImageLabelIndex,
  applyImageLabels,
  transformImagesOnSubmit,
  type LoadedImage,
  type ImageDataSource,
} from "../extensions/image-label.js";

// ── nextImageLabelIndex ────────────────────────────────────────────────

const idxCases: Array<[string, number]> = [
  ["", 1],
  ["[Image 1]", 2],
  ["[Image 1] [Image 2]", 3],
  ["[Image 1] some text [Image 3]", 4],
  ["[Image 2] [Image 1]", 3],        // unordered still picks max
  ["[Image 10]", 11],
  ["no labels here", 1],
  ["[Image 1]\n[Image 2]\n[Image 3]", 4],
  ["[image 1] [Image 2]", 3],       // case-sensitive: lowercase image is not counted
  ["[image 1] [image 2]", 1],       // discriminating: lowercase-only returns 1 (not counted)
  ["[Image 0]", 1],                 // [Image 0] matched but value 0, so next is 1
  ["[Image 1] [Image 1]", 2],       // duplicate: max is 1, so next is 2
];

// ── applyImageLabels ──────────────────────────────────────────────────

/** Test data: maps resolved paths to base64 image data + mime types. */
const testImageData = new Map<string, { data: string; mimeType: string }>([
  ["/images/photo.png", { data: "YWJj", mimeType: "image/png" }],     // "abc"
  ["/images/diagram.jpg", { data: "ZGVm", mimeType: "image/jpeg" }],   // "def"
  ["/images/chart.webp", { data: "Z2hp", mimeType: "image/webp" }],   // "ghi"
]);

/** Test double implementing ImageDataSource — production-neutral contract. */
const testDataSource: ImageDataSource = {
  readFile: (path: string) => {
    const entry = testImageData.get(path);
    return entry ? Buffer.from(entry.data, "base64") : null;
  },
  getMimeType: (path: string) => {
    return testImageData.get(path)?.mimeType ?? "image/png";
  },
};

/** Simulates the label-application logic used inside the terminal handler. */
function fakeApply(
  editorText: string,
  cleanedInput: string,
): { text: string; images: LoadedImage[] } {
  return applyImageLabels(cleanedInput, testDataSource, editorText);
}

// ── transformImagesOnSubmit ────────────────────────────────────────────

/** Wraps transformImagesOnSubmit with a mutable pendingImages array. */
function makeSubmitter(pending: LoadedImage[]) {
  return (eventImages: LoadedImage[]) =>
    transformImagesOnSubmit(pending, { text: "", images: eventImages });
}

// ── Runner ────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string, detail?: string) {
  if (cond) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

async function main() {
  console.log("🖼️  image-label Regression Tests\n");

  // ── nextImageLabelIndex ─────────────────────────────────────────────
  console.log("nextImageLabelIndex:");
  for (const [text, expected] of idxCases) {
    const actual = nextImageLabelIndex(text);
    assert(actual === expected, `input: ${JSON.stringify(text)} → ${expected}`, `got ${actual}`);
  }

  // ── Sequential drop labels ──────────────────────────────────────────
  console.log("\nSequential drop labels (three one-image drops):");

  // Drop 1 — empty editor
  let result = fakeApply("", "/images/photo.png");
  assert(result.text === "[Image 1]", "drop 1 → [Image 1]", result.text);
  assert(result.images.length === 1, "drop 1 → 1 image attached", `${result.images.length}`);
  assert(result.images[0].mimeType === "image/png", "drop 1 → correct mimeType", result.images[0].mimeType);

  // Drop 2 — editor already has [Image 1]
  result = fakeApply("[Image 1]", "/images/diagram.jpg");
  assert(result.text === "[Image 2]", "drop 2 → [Image 2]", result.text);
  assert(result.images.length === 1, "drop 2 → 1 image attached", `${result.images.length}`);

  // Drop 3 — editor already has [Image 1] [Image 2]
  result = fakeApply("[Image 1] [Image 2]", "/images/chart.webp");
  assert(result.text === "[Image 3]", "drop 3 → [Image 3]", result.text);
  assert(result.images.length === 1, "drop 3 → 1 image attached", `${result.images.length}`);

  // ── Pending images accumulate ──────────────────────────────────────
  console.log("\nPending images accumulate across drops:");

  const pending: LoadedImage[] = [];

  // Drop 1
  let drop = fakeApply("", "/images/photo.png");
  pending.push(...drop.images);
  assert(pending.length === 1, "after drop 1: 1 pending", `${pending.length}`);

  // Drop 2
  drop = fakeApply("[Image 1]", "/images/diagram.jpg");
  pending.push(...drop.images);
  assert(pending.length === 2, "after drop 2: 2 pending", `${pending.length}`);

  // Drop 3
  drop = fakeApply("[Image 1] [Image 2]", "/images/chart.webp");
  pending.push(...drop.images);
  assert(pending.length === 3, "after drop 3: 3 pending", `${pending.length}`);

  // ── Submission merges correctly ─────────────────────────────────────
  console.log("\nSubmission merging (Pi attachments first, then pending):");

  // Submit with Pi-provided attachment first
  const piAttachment: LoadedImage = {
    type: "image",
    data: "cGki",    // "pi"
    mimeType: "image/png",
  };
  const submit = makeSubmitter(pending);
  const transformed = submit([piAttachment]);

  assert(transformed.images.length === 4, "total images = 4 (1 Pi + 3 pending)", `${transformed.images.length}`);
  assert(transformed.images[0] === piAttachment, "Pi attachment is first");
  assert(transformed.images[1].data === "YWJj", "pending[0] (photo.png) is second");
  assert(transformed.images[2].data === "ZGVm", "pending[1] (diagram.jpg) is third");
  assert(transformed.images[3].data === "Z2hp", "pending[2] (chart.webp) is fourth");
  assert(transformed.action === "transform", "action is transform");

  // Submit again — pending is now empty; no duplicates
  const secondSubmit = makeSubmitter(pending);
  const secondTransformed = secondSubmit([piAttachment]);

  assert(secondTransformed.action === "continue", "second submit: action is continue (no pending)");
  // MUST NOT include images property when action is 'continue' — vacuous alternate success branch
  assert(!("images" in secondTransformed),
    "second submit: action=continue must NOT include images property",
    "images" in secondTransformed ? `found images (${secondTransformed.images?.length})` : "absent (correct)");
  assert(pending.length === 0, "pendingImages cleared after first submit", `${pending.length}`);

  // ── Mixed readable/unreadable paths ─────────────────────────────────
  console.log("\nMixed readable/unreadable paths:");

  // Test datasource with both readable and unreadable paths
  const mixedDataSource: ImageDataSource = {
    readFile: (path: string) => {
      const entry = testImageData.get(path);
      return entry ? Buffer.from(entry.data, "base64") : null;
    },
    getMimeType: (path: string) => testImageData.get(path)?.mimeType ?? "image/png",
  };

  // Simulate: readable, then unreadable, then readable
  const mixedInput = "/images/photo.png\n/nonexistent/broken.png\n/images/diagram.jpg";

  // Editor starts empty, so first readable gets [Image 1]
  const mixedResult = applyImageLabels(mixedInput, mixedDataSource, "");

  assert(
    mixedResult.text.includes("[Image 1]"),
    "readable photo.png gets [Image 1]",
    mixedResult.text,
  );
  assert(
    mixedResult.text.includes("nonexistent/broken.png"),
    "unreadable path stays verbatim in text",
    mixedResult.text,
  );
  assert(
    mixedResult.text.includes("[Image 2]"),
    "second readable diagram.jpg gets [Image 2]",
    mixedResult.text,
  );
  assert(
    mixedResult.images.length === 2,
    "only 2 images attached (unreadable skipped)",
    `${mixedResult.images.length}`,
  );
  assert(
    mixedResult.images[0].mimeType === "image/png",
    "first image is photo.png",
    mixedResult.images[0].mimeType,
  );
  assert(
    mixedResult.images[1].mimeType === "image/jpeg",
    "second image is diagram.jpg",
    mixedResult.images[1].mimeType,
  );

  // Verify label counter does NOT include unreadable path
  // After drop with 2 labels, next drop starts at [Image 3]
  const followUp = applyImageLabels("/images/chart.webp", mixedDataSource, mixedResult.text);
  assert(
    followUp.text === "[Image 3]",
    "follow-up drop gets [Image 3] (no gap from unreadable)",
    followUp.text,
  );

  // ── Summary ─────────────────────────────────────────────────────────
  console.log(`\n${"═".repeat(50)}`);
  console.log(`✅ ${passed} passed   ❌ ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log("\n🎉 All assertions passed!");
  }
}

main();
