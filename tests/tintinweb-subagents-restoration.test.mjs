import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
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

function frontmatter(path) {
  const match = read(path).match(/^---\n([\s\S]*?)\n---/);
  assert.ok(match, `${path} must have YAML frontmatter`);
  return match[1];
}

function combined(paths) {
  return paths.map((path) => `\n--- ${path} ---\n${read(path)}`).join("\n");
}

function markdownSection(path, startHeading, endHeading) {
  const document = read(path);
  const start = document.indexOf(startHeading);
  const end = document.indexOf(endHeading, start + startHeading.length);
  assert.notEqual(start, -1, `${path} must contain ${startHeading}`);
  assert.notEqual(end, -1, `${path} must contain ${endHeading}`);
  return document.slice(start, end);
}

function assertTintinwebOnly(paths) {
  const resources = combined(paths);
  for (const pattern of [
    /workflowScript/,
    /runs\.run\s*\(/,
    /runs\.all\s*\(/,
    /subagent_wait\s*\(/,
    /action:\s*["']steer["']/,
    /systemPromptMode/,
    /nicobailon/i,
  ]) {
    assert.doesNotMatch(resources, pattern, `active guidance contains ${pattern}`);
  }
  return resources;
}

const primaryWorkflowPaths = [
  "prompts/implement.md",
  "prompts/implement-and-review.md",
  "prompts/scout-and-plan.md",
  "skills/dispatching-parallel-agents/SKILL.md",
  "skills/using-superpowers/SKILL.md",
  "skills/executing-plans/SKILL.md",
];

const developmentWorkflowPaths = [
  "skills/subagent-driven-development/SKILL.md",
  "skills/subagent-driven-development/implementer-prompt.md",
  "skills/subagent-driven-development/spec-reviewer-prompt.md",
  "skills/subagent-driven-development/code-quality-reviewer-prompt.md",
];

const specializedWorkflowPaths = [
  "skills/auditing-codebase/procedure.md",
  "skills/improve-codebase-architecture/SKILL.md",
  "skills/improve-codebase-architecture/INTERFACE-DESIGN.md",
];

test("package selects Tintinweb and preserves current package contracts", () => {
  const manifest = readJson("package.json");
  const lockfile = readJson("package-lock.json");

  assert.equal(manifest.dependencies?.["@tintinweb/pi-subagents"], "^0.15.0");
  assert.equal(manifest.pi?.subagents, undefined);
  const lockedRuntime = lockfile.packages?.["node_modules/@tintinweb/pi-subagents"];
  assert.match(lockedRuntime?.version ?? "", /^0\.15\./);
  assert.equal(lockfile.packages?.["node_modules/pi-subagents"], undefined);
  assert.equal(lockfile.packages?.["node_modules/@mariozechner/pi-coding-agent"], undefined);

  for (const peer of [
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-tui",
  ]) {
    assert.equal(manifest.peerDependencies?.[peer], "*", peer);
  }
  assert.equal(manifest.devDependencies?.typescript, "5.9.3");
  assert.equal(manifest.devDependencies?.tsx, "4.23.11");

  const runtimeManifest = readJson("node_modules/@tintinweb/pi-subagents/package.json");
  assert.equal(runtimeManifest.version, lockedRuntime.version);
  for (const peer of [
    "@earendil-works/pi-ai",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-tui",
  ]) {
    assert.equal(runtimeManifest.peerDependencies?.[peer], ">=0.80.0", peer);
  }
  assert.equal(runtimeManifest.dependencies?.["@mariozechner/pi-coding-agent"], undefined);

  const extensionPath = runtimeManifest.pi?.extensions?.[0]?.replace(/^\.\//, "");
  assert.ok(extensionPath, "Tintinweb must publish a Pi extension entrypoint");
  const runtimeSource = read(`node_modules/@tintinweb/pi-subagents/${extensionPath}`);
  const runnerSource = read("node_modules/@tintinweb/pi-subagents/src/agent-runner.ts");
  assert.match(runnerSource, /AGENT:\s*["']Agent["']/);
  assert.match(runnerSource, /GET_RESULT:\s*["']get_subagent_result["']/);
  assert.match(runnerSource, /STEER:\s*["']steer_subagent["']/);
  assert.match(runtimeSource, /name:\s*SUBAGENT_TOOL_NAMES\.AGENT[\s\S]*?prompt:\s*Type\.String[\s\S]*?subagent_type:\s*Type\.String[\s\S]*?run_in_background:\s*Type\.Optional[\s\S]*?isolation:\s*Type\.Optional/);
  assert.match(runtimeSource, /name:\s*SUBAGENT_TOOL_NAMES\.GET_RESULT[\s\S]*?agent_id:\s*Type\.String[\s\S]*?wait:\s*Type\.Optional/);
  assert.match(runtimeSource, /name:\s*SUBAGENT_TOOL_NAMES\.STEER[\s\S]*?agent_id:\s*Type\.String[\s\S]*?message:\s*Type\.String/);
  assert.match(runtimeSource, /Type\.Literal\(["']worktree["']/);
});

test("agents use Tintinweb frontmatter", () => {
  const agentFiles = filesUnder("agents", ".md").filter((p) => !p.endsWith(".bak"));
  const expected = [
    "explore.md",
    "planner.md",
    "reviewer.md",
    "scout.md",
    "worker.md",
    "quick-worker.md",
    "deep-worker.md",
    "deep-reviewer.md",
  ];
  assert.equal(agentFiles.length, 8, `expected 8 agent files, got ${agentFiles.length}: ${agentFiles.join(", ")}`);
  for (const name of expected) {
    assert.ok(agentFiles.includes(`agents/${name}`), `missing agent: ${name}`);
  }
  for (const path of agentFiles) {
    const yaml = frontmatter(path);
    assert.doesNotMatch(yaml, /(?:^|\n)name:/, path);
    assert.doesNotMatch(yaml, /(?:^|\n)systemPromptMode:/, path);
    assert.doesNotMatch(yaml, /(?:^|[ ,])multi_grep(?:,|$)/, path);
    // Must have required bounded fields
    assert.match(yaml, /(?:^|\n)thinking: /, `${path} must have thinking:`);
    assert.match(yaml, /(?:^|\n)max_turns: /, `${path} must have max_turns:`);
    // Verify expected thinking/max_turns for each agent
    if (path === "agents/explore.md") {
      assert.match(yaml, /thinking: low/, path);
      assert.match(yaml, /max_turns: 4/, path);
    } else if (path === "agents/planner.md") {
      assert.match(yaml, /thinking: medium/, path);
      assert.match(yaml, /max_turns: 8/, path);
    } else if (path === "agents/reviewer.md") {
      assert.match(yaml, /thinking: low/, path);
      assert.match(yaml, /max_turns: 6/, path);
    } else if (path === "agents/scout.md") {
      assert.match(yaml, /thinking: low/, path);
      assert.match(yaml, /max_turns: 6/, path);
    } else if (path === "agents/worker.md") {
      assert.match(yaml, /thinking: medium/, path);
      assert.match(yaml, /max_turns: 10/, path);
      assert.match(yaml, /(?:^|\n)prompt_mode: append(?:\n|$)/);
    } else if (path === "agents/quick-worker.md") {
      assert.match(yaml, /thinking: low/, path);
      assert.match(yaml, /max_turns: 8/, path);
    } else if (path === "agents/deep-worker.md") {
      assert.match(yaml, /thinking: high/, path);
      assert.match(yaml, /max_turns: 14/, path);
    } else if (path === "agents/deep-reviewer.md") {
      assert.match(yaml, /thinking: high/, path);
      assert.match(yaml, /max_turns: 8/, path);
    }
  }
});

test("primary workflows use Tintinweb", () => {
  const resources = assertTintinwebOnly(primaryWorkflowPaths);
  for (const pattern of [
    /@tintinweb\/pi-subagents/,
    /\bAgent\s*\(/,
    /get_subagent_result\s*\(/,
    /steer_subagent\s*\(/,
    /subagent_type/,
    /run_in_background/,
    /isolation:\s*["']worktree["']/,
  ]) {
    assert.match(resources, pattern);
  }

  const dispatchSkill = read("skills/dispatching-parallel-agents/SKILL.md");
  const writerCalls = dispatchSkill
    .split("\n")
    .filter((line) =>
      line.startsWith("Agent({") &&
      /subagent_type: ["']worker["']/.test(line) &&
      /run_in_background: true/.test(line),
    );
  assert.ok(writerCalls.length >= 4, "parallel dispatch must show every writer explicitly");
  for (const call of writerCalls) {
    assert.match(call, /isolation: ["']worktree["']/, "each parallel writer must use worktree isolation");
    assert.match(call, /isolation[^.]*fail[^.]*STOP without edits/i, "each writer must abort if isolation fails");
    assert.match(call, /Do not commit/i, "each isolated writer must leave changes for the runtime");
    assert.match(
      call,
      /(?:runtime to return as a branch|Tintinweb return the isolated branch)/i,
      "each isolated writer prompt must require a runtime-returned branch",
    );
  }
  assert.match(dispatchSkill, /fails loud/i);
  assert.doesNotMatch(dispatchSkill, /0\.5\.2 falls back/i);
  assert.match(dispatchSkill, /integrate returned branches one at a time/i);
});

test("subagent-driven development uses Tintinweb", () => {
  const resources = assertTintinwebOnly(developmentWorkflowPaths);
  for (const pattern of [
    /@tintinweb\/pi-subagents/,
    /\bAgent\s*\(/,
    /get_subagent_result\s*\(/,
    /steer_subagent\s*\(/,
    /run_in_background/,
    /spec review/i,
    /code quality review/i,
  ]) {
    assert.match(resources, pattern);
  }

  const skill = read("skills/subagent-driven-development/SKILL.md");
  const isolatedWriterCalls = skill.match(
    /Agent\(\{[^\n]*subagent_type: ["']worker["'][^\n]*run_in_background: true[^\n]*isolation: ["']worktree["'][^\n]*\}\)/g,
  ) ?? [];
  assert.ok(isolatedWriterCalls.length >= 3, "parallel writers must use worktree isolation");

  const sequential = markdownSection(
    "skills/subagent-driven-development/SKILL.md",
    "### Sequential Dispatch Pattern",
    "### Handling Mixed Results",
  );
  assert.match(sequential, /run_in_background: true/);
  assert.match(sequential, /steer_subagent\s*\(/);
  assert.match(sequential, /get_subagent_result\s*\(/);

  const implementerPrompt = read("skills/subagent-driven-development/implementer-prompt.md");
  assert.match(implementerPrompt, /worktree isolation[\s\S]*do not commit/i);
  assert.match(implementerPrompt, /runtime[\s\S]*branch/i);
  assert.match(implementerPrompt, /isolation[^.\n]*fail[\s\S]*stop[\s\S]*without[^.\n]*edit/i);
  assert.match(skill, /fails loud[\s\S]*abort without edits/i);
  assert.match(skill, /frontmatter[\s\S]*takes precedence[\s\S]*Agent\(\)/i);

  const backgroundReviewerCalls = skill.match(
    /Agent\(\{[^\n]*subagent_type: ["']reviewer["'][^\n]*run_in_background: true[^\n]*\}\)/g,
  ) ?? [];
  const collectedReviewerResults = skill.match(
    /get_subagent_result\(\{ agent_id: ["'](?:spec|quality)-review-[^"']+["'], wait: true \}\)/g,
  ) ?? [];
  assert.ok(backgroundReviewerCalls.length > 0, "the skill must show parallel background reviewers");
  assert.equal(collectedReviewerResults.length, backgroundReviewerCalls.length);
});

test("specialized workflows use Tintinweb", () => {
  const resources = assertTintinwebOnly(specializedWorkflowPaths);
  assert.match(resources, /\bAgent\s*\(/);
  assert.match(resources, /get_subagent_result\s*\(/);
  assert.match(resources, /run_in_background/);
  assert.match(resources, /peer[- ]rank/i);
  assert.match(resources, /judge/i);

  const peerRanking = markdownSection(
    "skills/auditing-codebase/procedure.md",
    "### Step 4 — Peer-ranking",
    "### Step 5 — Judge consolidation",
  );
  assert.match(peerRanking, /record[^.\n]*agent ID/i);
  assert.match(peerRanking, /get_subagent_result\s*\([^)]*wait:\s*true/);
});

test("README documents Tintinweb and preserves current features", () => {
  const readme = read("README.md");
  assert.match(readme, /pi install npm:@tintinweb\/pi-subagents(?:\s|`)/);
  assert.match(readme, /cp agents\/\*\.md ~\/\.pi\/agent\/agents\//);
  assert.match(readme, /\.pi\/agents/);
  assert.doesNotMatch(readme, /npm:pi-subagents/);
  assert.doesNotMatch(readme, /nicobailon/i);
  assert.match(readme, /npm:@getpipher\/vision@0\.5\.2/);
  assert.match(readme, /token-speed/);
  assert.match(readme, /council/);
});

test("Nicobailon migration is historical", () => {
  const paths = [
    "docs/superpowers/specs/2026-08-07-pi-subagents-and-vision-migration-design.md",
    "docs/superpowers/plans/2026-08-07-pi-subagents-and-vision-migration.md",
  ];
  for (const path of paths) {
    const document = read(path);
    assert.match(document.slice(0, 600), /historical|reverted/i, path);
    assert.match(document.slice(0, 600), /2026-08-10-tintinweb-subagents-restoration-design\.md/, path);
  }

  const todo = read("tasks/todo.md");
  assert.match(todo, /^# Historical:/);
  assert.match(todo, /2026-08-10-tintinweb-subagents-restoration-design\.md/);
});

test("agent-config extension is present and integrable", () => {
  const manifest = readJson("package.json");

  // Extension files exist.
  assert.equal(existsSync(join(root, "extensions/agent-config/index.ts")), true);
  assert.equal(existsSync(join(root, "extensions/agent-config/src/workflow.ts")), true);
  assert.equal(existsSync(join(root, "extensions/agent-config/src/discovery.ts")), true);
  assert.equal(existsSync(join(root, "extensions/agent-config/test/handler.test.ts")), true);
  assert.equal(existsSync(join(root, "extensions/agent-config/test/smoke.test.ts")), true);

  // Entrypoint registers /agent-config.
  const entrypoint = read("extensions/agent-config/index.ts");
  assert.match(entrypoint, /agent[- ]?config/i);

  // Root package declares required deps.
  assert.equal(manifest.dependencies?.["yaml"], "^2.6.1");
  assert.ok(manifest.devDependencies?.["vitest"], "vitest must be in devDependencies");
  assert.ok(manifest.devDependencies?.["@types/node"], "@types/node must be in devDependencies");

  // Root test script runs agent-config tests.
  assert.match(manifest.scripts?.["test"] ?? "", /test:agent-config/);
  assert.ok(manifest.scripts?.["test:agent-config"], "test:agent-config script must exist");
  assert.ok(manifest.scripts?.["typecheck:agent-config"], "typecheck:agent-config script must exist");

  // Vitest config exists for the extension.
  assert.equal(existsSync(join(root, "extensions/agent-config/vitest.config.ts")), true);

  // Discovery is aligned with @tintinweb/pi-subagents 0.15.x built-in.
  const discoverySource = read("extensions/agent-config/src/discovery.ts");
  assert.match(discoverySource, /DEFAULT_AGENTS|builtin/i);
});

test("removed runtimes stay removed", () => {
  const manifest = readJson("package.json");
  assert.equal(existsSync(join(root, "extensions/discord")), false);
  assert.equal(manifest.dependencies?.["discord.js"], undefined);
  assert.equal(existsSync(join(root, "extensions/image-label.ts")), false);
  assert.equal(existsSync(join(root, "extensions/image-describe")), false);
  assert.equal(existsSync(join(root, "tests/image-label.test.ts")), false);
  assert.equal(existsSync(join(root, "extensions/token-speed/index.ts")), true);
  assert.equal(existsSync(join(root, "extensions/council/index.ts")), true);
});
