import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const readJson = (path) => JSON.parse(read(path));

function filesUnder(path, extension) {
  const absolute = join(root, path);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    if (entry.isDirectory()) return filesUnder(child, extension);
    return !extension || extname(entry.name) === extension ? [child] : [];
  });
}

const activeResourcePaths = [
  "README.md",
  "package.json",
  "package-lock.json",
  ...filesUnder("agents", ".md"),
  ...filesUnder("prompts", ".md"),
  ...filesUnder("skills", ".md"),
];

const activeResources = activeResourcePaths
  .map((path) => `\n--- ${path} ---\n${read(path)}`)
  .join("\n");

function frontmatter(path) {
  const match = read(path).match(/^---\n([\s\S]*?)\n---/);
  assert.ok(match, `${path} must have YAML frontmatter`);
  return match[1];
}

test("package removes Tintinweb and publishes custom agents", () => {
  const manifest = readJson("package.json");
  assert.equal(manifest.dependencies?.["@tintinweb/pi-subagents"], undefined);
  assert.deepEqual(manifest.pi?.subagents?.agents, ["./agents"]);
  assert.doesNotMatch(read("package-lock.json"), /@tintinweb\/pi-subagents/);
});

test("package agents use pi-subagents frontmatter", () => {
  for (const path of filesUnder("agents", ".md")) {
    const yaml = frontmatter(path);
    const expectedName = basename(path, ".md");
    assert.match(yaml, new RegExp(`(?:^|\\n)name: ${expectedName}(?:\\n|$)`), path);
    assert.doesNotMatch(yaml, /(?:^|\n)prompt_mode:/, path);
  }
  assert.match(frontmatter("agents/worker.md"), /(?:^|\n)systemPromptMode: append(?:\n|$)/);
  assert.ok(existsSync(join(root, "agents/planner.md")), "custom planner must remain packaged");
});

test("active resources use only the Nicobailon orchestration API", () => {
  const forbidden = [
    /@tintinweb\/pi-subagents/,
    /\bAgent\s*\(/,
    /get_subagent_result/,
    /steer_subagent/,
    /subagent_type/,
    /isolation:\s*["']worktree["']/,
  ];
  for (const pattern of forbidden) assert.doesNotMatch(activeResources, pattern);

  const nonVisualCompanion = activeResourcePaths
    .filter((path) => path !== "skills/brainstorming/visual-companion.md")
    .map(read)
    .join("\n");
  assert.doesNotMatch(nonVisualCompanion, /run_in_background/);
});

test("active workflows document the required v0.43 contracts", () => {
  assert.match(activeResources, /workflowScript/);
  assert.match(activeResources, /workflowScript[\s\S]{0,1000}\breturn\b/);
  assert.match(activeResources, /runs\.run\s*\(/);
  assert.match(activeResources, /runs\.all\s*\(/);
  assert.match(activeResources, /subagent_wait\s*\(/);
  assert.match(activeResources, /action:\s*["']steer["']/);
  assert.match(activeResources, /worktree:\s*true/);
});

test("local image extensions are replaced by pinned Vision", () => {
  assert.equal(existsSync(join(root, "extensions/image-label.ts")), false);
  assert.equal(existsSync(join(root, "extensions/image-describe")), false);
  assert.equal(existsSync(join(root, "tests/image-label.test.ts")), false);
  assert.match(read("README.md"), /npm:@getpipher\/vision@0\.5\.2/);

  const manifest = readJson("package.json");
  assert.ok(manifest.pi?.extensions?.includes("./extensions"));
});
