# Pi Subagents and Vision Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make this package and the user's global Pi installation use `pi-subagents@0.43.0` and `@getpipher/vision@0.5.2`, with no active Tintinweb or local image-extension runtime.

**Architecture:** Treat Nicobailon's package as a separately installed Pi prerequisite rather than a nested Node dependency. Publish this package's custom agents through `pi.subagents.agents`, migrate all active orchestration guidance to `workflowScript`, and use one static contract test to prevent old APIs or removed image resources from returning.

**Tech Stack:** Pi packages, TypeScript/Markdown skills, Node.js built-in test runner, npm lockfiles, `pi-subagents` workflow API.

---

## File Structure

- `package.json`: remove the obsolete Node dependency, expose package agents, and add the migration contract test script.
- `package-lock.json`: remove Tintinweb's dependency graph after a clean npm install.
- `README.md`: document pinned Pi prerequisites, automatic custom-agent discovery, and the external vision replacement.
- `agents/*.md`: conform package-provided agents to Nicobailon's frontmatter contract while preserving their responsibilities, including `planner`.
- `tests/pi-subagents-migration.test.mjs`: enforce manifest, agent-discovery, active-documentation, workflow-syntax, and image-removal contracts.
- `skills/dispatching-parallel-agents/SKILL.md`: become the concise source of truth for one, sequential, parallel, asynchronous, steering, and worktree workflows.
- `skills/subagent-driven-development/SKILL.md` and adjacent prompt files: express task implementation and two-stage review with coordinated workflows.
- `prompts/*.md`: migrate reusable scout/planner/worker/reviewer pipelines.
- `skills/auditing-codebase/procedure.md`, `skills/improve-codebase-architecture/{SKILL.md,INTERFACE-DESIGN.md}`: migrate specialized dispatch instructions.
- `skills/using-superpowers/SKILL.md`, `skills/executing-plans/SKILL.md`: name the new runtime and tools.
- `extensions/image-label.ts`, `extensions/image-describe/index.ts`, `tests/image-label.test.ts`: delete local functionality superseded by `@getpipher/vision`.

**Primary references:**
- Approved design: `docs/superpowers/specs/2026-08-07-pi-subagents-and-vision-migration-design.md`
- Nicobailon v0.43 agents: `https://github.com/nicobailon/pi-subagents/blob/v0.43.0/docs/agents.md`
- Workflow API: `https://github.com/nicobailon/pi-subagents/blob/v0.43.0/docs/workflows.md`
- Tool API: `https://github.com/nicobailon/pi-subagents/blob/v0.43.0/docs/tool-reference.md`
- Vision package: `https://github.com/getpipher/vision/tree/v0.5.2`

---

### Task 1: Add a Failing Migration Contract Test

**Files:**
- Create: `tests/pi-subagents-migration.test.mjs`
- Modify: `package.json`

**Contract:**

```json
{
  "scripts": {
    "test:migration": "node --test tests/pi-subagents-migration.test.mjs"
  }
}
```

The test uses only Node built-ins. It treats `README.md`, `package.json`, `package-lock.json`, `agents/**/*.md`, `prompts/**/*.md`, and `skills/**/*.md` as active resources, except that the Bash-specific `run_in_background` wording in `skills/brainstorming/visual-companion.md` is not a subagent violation.

- [x] **Step 1: Write the failing manifest and agent-discovery assertions**

Assert that neither manifest contains `@tintinweb/pi-subagents`; `package.json` declares `pi.subagents.agents` as exactly `["./agents"]`; and every `agents/*.md` file has a `name` matching its filename and contains no `prompt_mode` field.

- [x] **Step 2: Write the failing active-resource API assertions**

Assert that active resources do not advertise Tintinweb or use `Agent(`, `get_subagent_result`, `steer_subagent`, `subagent_type`, or subagent-specific `run_in_background`/`isolation: "worktree"`. Assert representative new contracts exist across the active resources: `workflowScript`, explicit `return`, `runs.run`, `runs.all`, `subagent_wait`, `action: "steer"`, and `worktree: true`.

- [x] **Step 3: Write the failing image-removal assertions**

Assert that `extensions/image-label.ts`, `extensions/image-describe/`, and `tests/image-label.test.ts` do not exist; README identifies `npm:@getpipher/vision@0.5.2` as the replacement; and the package still exposes the unaffected extensions directory.

- [x] **Step 4: Register and run the contract test**

Run: `npm run test:migration`

Expected: FAIL for the current Tintinweb dependency/API references, missing package-agent declaration, incompatible frontmatter, and existing local image files.

- [x] **Step 5: Commit the red test**

```bash
git add package.json tests/pi-subagents-migration.test.mjs
git commit -m "test: define pi-subagents migration contract"
```

### Task 2: Migrate the Package Manifest and Agent Discovery

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `README.md`
- Modify: `agents/explore.md`
- Modify: `agents/planner.md`
- Modify: `agents/reviewer.md`
- Modify: `agents/scout.md`
- Modify: `agents/worker.md`
- Test: `tests/pi-subagents-migration.test.mjs`

**Manifest contract:**

```json
{
  "pi": {
    "subagents": {
      "agents": ["./agents"]
    }
  }
}
```

Each agent frontmatter must include a `name` equal to the file's basename (`explore`, `planner`, `reviewer`, `scout`, or `worker`). Replace `prompt_mode: append` with `systemPromptMode: append`; preserve the existing descriptions, tool restrictions, models, and prompt bodies.

- [x] **Step 1: Update `package.json`**

Remove `@tintinweb/pi-subagents` without adding `pi-subagents` as a Node dependency. Add the package-agent discovery contract while preserving the existing extension, skill, prompt, peer dependency, and `discord.js` declarations.

- [x] **Step 2: Regenerate the lockfile**

Run: `npm install --package-lock-only`

Expected: exit 0; `package-lock.json` no longer contains Tintinweb or its obsolete nested Pi 0.62 dependency graph.

- [x] **Step 3: Adapt all agent frontmatter**

Add explicit runtime names and migrate the worker's system-prompt mode. Confirm the custom `planner` remains read-only and package-discoverable; do not replace it with `oracle`.

- [x] **Step 4: Update setup documentation**

Replace the Tintinweb installation and manual `cp agents/*.md` setup with pinned Pi package commands for `npm:pi-subagents@0.43.0` and `npm:@getpipher/vision@0.5.2`. Explain that this package publishes its agents automatically and distinguish custom `planner` from builtin advisory `oracle`.

- [x] **Step 5: Run the focused contract test**

Run: `npm run test:migration`

Expected: still FAIL only for unmigrated skill/prompt APIs and existing local image files; manifest, lockfile, agent-frontmatter, and README assertions pass.

- [x] **Step 6: Commit the package migration**

```bash
git add package.json package-lock.json README.md agents tests/pi-subagents-migration.test.mjs
git commit -m "chore: publish agents for pi-subagents"
```

### Task 3: Rewrite the Parallel Dispatch Source of Truth

**Files:**
- Modify: `skills/dispatching-parallel-agents/SKILL.md`
- Modify: `skills/using-superpowers/SKILL.md`
- Modify: `skills/executing-plans/SKILL.md`
- Test: `tests/pi-subagents-migration.test.mjs`

**Workflow contracts:**

```ts
subagent({ workflowScript: string, async?: boolean, context?: "fresh" | "fork" })
runs.run(key, { agent: string, task: string, worktree?: boolean })
runs.all([{ key: string, agent: string, task: string, worktree?: boolean }])
subagent_wait({ id: string })
subagent({ action: "steer", id: string, message: string, mode?: "steer" | "follow_up" | "auto" })
```

Every workflow script is an ordinary JavaScript statement body and must explicitly `return` its useful result. `async: false` is required for a watched foreground workflow; asynchronous examples retain the returned workflow ID and call `subagent_wait`.

- [x] **Step 1: Rewrite single and sequential examples**

Use one `workflowScript`; single work calls `runs.run`, while sequential work awaits each stage and passes prior `.output` into the next stage's `task`. Keep stable, descriptive run keys and preserve `planner` in planning pipelines.

- [x] **Step 2: Rewrite parallel examples**

Use one `runs.all` call for an independent batch rather than multiple model-level tool calls. Require unique keys, explicit task briefs, and `worktree: true` per writing child when files may overlap. Explain that read-only parallel children do not need worktrees.

- [x] **Step 3: Rewrite asynchronous collection and steering guidance**

Show explicit `async: true`, retention of the top-level workflow ID, blocking collection with `subagent_wait`, status through `subagent({ action: "status", id })`, and steering through the contract above. Remove claims tied specifically to Tintinweb's widget or agent IDs.

- [x] **Step 4: Update platform references**

Make `using-superpowers` and `executing-plans` identify Nicobailon's `subagent`/`subagent_wait` runtime. Preserve their fallback behavior when no subagent package is available.

- [x] **Step 5: Run focused assertions**

Run: `npm run test:migration`

Expected: the three modified skills contain no forbidden API references and supply the representative new syntax; the overall test still fails for other unmigrated active resources and image files.

- [x] **Step 6: Commit the source-of-truth rewrite**

```bash
git add skills/dispatching-parallel-agents/SKILL.md skills/using-superpowers/SKILL.md skills/executing-plans/SKILL.md tests/pi-subagents-migration.test.mjs
git commit -m "docs: migrate parallel dispatch to workflowScript"
```

### Task 4: Migrate Subagent-Driven Development and Review Prompts

**Files:**
- Modify: `skills/subagent-driven-development/SKILL.md`
- Modify: `skills/subagent-driven-development/implementer-prompt.md`
- Modify: `skills/subagent-driven-development/spec-reviewer-prompt.md`
- Modify: `skills/subagent-driven-development/code-quality-reviewer-prompt.md`
- Test: `tests/pi-subagents-migration.test.mjs`

**Behavioral contract:** Preserve the existing parent-controlled loop: clarify, implement, fresh spec review, fix gaps, fresh quality review, and final repository review. Each writing phase has one writer unless independent writes use managed worktrees. Reviewers remain read-only and receive the exact task, changed-file/commit scope, and worker evidence.

- [x] **Step 1: Rewrite the orchestration flow and diagrams**

Replace every Tintinweb tool name and lifecycle node. Describe foreground per-task workflows with `async: false`; describe independent batches with one `runs.all` call per phase; and require explicit useful returns from each script.

- [x] **Step 2: Preserve fresh-review boundaries**

Ensure spec and quality reviewers are new `reviewer` children that do not inherit the implementer's assumptions. Have their tasks include the original task text and repository scope rather than trusting only the worker's summary.

- [x] **Step 3: Adapt clarification and intervention behavior**

For child-initiated decisions, instruct workers to use Nicobailon's `contact_supervisor` channel and the parent to reply through `subagent_supervisor`. Keep `subagent({ action: "steer", ... })` for parent-initiated correction of a live asynchronous run. Remove the old assumption that `steer_subagent` answers all questions.

- [x] **Step 4: Rewrite the three reusable prompt files**

Make each file provide the complete `task` brief expected inside `runs.run` or a `runs.all` item. Preserve implementer self-review, spec-only review, and quality-review responsibilities without embedding obsolete model-level `Agent(...)` calls.

- [x] **Step 5: Keep model guidance compatible**

Document v0.43 precedence—per-run model, agent frontmatter, settings overrides/default, then parent—without claiming an `Agent()` parameter. Retain custom `planner`; identify `oracle` only as an optional advisory second opinion.

- [x] **Step 6: Run focused assertions**

Run: `npm run test:migration`

Expected: no forbidden API remains in `skills/subagent-driven-development/`; the overall test still fails only for other active resources and image files.

- [x] **Step 7: Commit the development workflow migration**

```bash
git add skills/subagent-driven-development tests/pi-subagents-migration.test.mjs
git commit -m "docs: migrate subagent development workflows"
```

### Task 5: Migrate Reusable Pipelines and Specialized Skills

**Files:**
- Modify: `prompts/implement.md`
- Modify: `prompts/scout-and-plan.md`
- Modify: `prompts/implement-and-review.md`
- Modify: `skills/auditing-codebase/procedure.md`
- Modify: `skills/improve-codebase-architecture/SKILL.md`
- Modify: `skills/improve-codebase-architecture/INTERFACE-DESIGN.md`
- Test: `tests/pi-subagents-migration.test.mjs`

- [x] **Step 1: Migrate the three prompt pipelines**

Express each pipeline as one explicit-return workflow. `scout-and-plan` runs `scout` then custom `planner`; `implement` runs `scout`, `planner`, then `worker`; `implement-and-review` runs `worker`, fresh `reviewer`, then a worker fix stage. Pass prior `.output` through task text and use `async: false` for these user-invoked foreground pipelines.

- [x] **Step 2: Migrate the auditing procedure**

Replace batches of `Agent` calls and per-ID waits with keyed `runs.all` workflows. Use Nicobailon's `delegate` role for general model-directed auditor/ranker work, preserve per-run model selection and independent output paths, and explicitly return every auditor/ranker result so missing or failed outputs remain detectable.

- [x] **Step 3: Migrate architecture exploration**

Use the package's lowercase `explore` or builtin `scout` agent name consistently. Replace three independent interface-design calls with one `runs.all` batch whose keys encode the distinct design constraints, then return and compare all outputs.

- [x] **Step 4: Verify no active orchestration references remain**

Run:

```bash
rg -n '@tintinweb/pi-subagents|\bAgent\(|get_subagent_result|steer_subagent|subagent_type|isolation: "worktree"' README.md package.json package-lock.json agents prompts skills
```

Expected: no matches. A separate `run_in_background` occurrence is allowed only in `skills/brainstorming/visual-companion.md`, where it documents a Bash-tool option rather than subagents.

- [x] **Step 5: Run the migration contract test**

Run: `npm run test:migration`

Expected: workflow and manifest assertions pass; only existing local image resources keep the suite red.

- [x] **Step 6: Commit the remaining workflow migration**

```bash
git add prompts skills/auditing-codebase/procedure.md skills/improve-codebase-architecture tests/pi-subagents-migration.test.mjs
git commit -m "docs: migrate packaged subagent pipelines"
```

### Task 6: Remove Local Image Handling in Favor of Vision

**Files:**
- Delete: `extensions/image-label.ts`
- Delete: `extensions/image-describe/index.ts`
- Delete: `tests/image-label.test.ts`
- Modify: `README.md`
- Test: `tests/pi-subagents-migration.test.mjs`

- [x] **Step 1: Remove the local image resources and regression test**

Delete both extensions so the package's `./extensions` discovery cannot load duplicate terminal-input, attachment, model-routing, compression, or cache behavior. Delete the test that exclusively specifies the removed `image-label` implementation.

- [x] **Step 2: Finalize image documentation**

Remove `image-label` from the included-extension table. State that image labeling and text-only vision delegation are intentionally provided by the separately installed pinned `@getpipher/vision` package. Leave dated design/plan documents as historical records; do not present them as current setup instructions.

- [x] **Step 3: Run the migration contract test to green**

Run: `npm run test:migration`

Expected: PASS with zero failures; manifests, agents, active workflows, and image-resource removal all satisfy the migration contract.

- [x] **Step 4: Re-run TypeScript to update the failure baseline**

Run: `npm exec -- tsc --noEmit`

Expected at this stage: image modules no longer appear in diagnostics. Remaining failures are limited to tracked Discord/Council/example issues and the separately owned `token-speed` module-resolution contract addressed in Task 7.

- [x] **Step 5: Commit the vision replacement boundary**

```bash
git add -A extensions/image-label.ts extensions/image-describe tests/image-label.test.ts README.md tests/pi-subagents-migration.test.mjs
git commit -m "refactor: replace local image extensions with vision"
```

### Task 7: Remove Discord and Restore the TypeScript Baseline

**Files:**
- Delete: `extensions/discord/`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tsconfig.json`
- Modify: `extensions/council/index.ts`
- Modify: `extensions/council/openrouter.ts`
- Test: `tests/pi-subagents-migration.test.mjs`
- Do not modify: `extensions/token-speed/`, `tests/token-speed.test.ts`

- [x] **Step 1: Extend the migration contract and verify RED**

Assert that `extensions/discord/` is absent, `discord.js` is absent from both manifests, `typescript` is pinned to 5.9.3 in `devDependencies`, and `@earendil-works/pi-coding-agent` is declared as a `*` peer. Run `npm run test:migration` and confirm it fails because Discord still exists and remains declared.

- [x] **Step 2: Remove Discord and its dependency**

Delete the tracked Discord directory, remove `discord.js`, and regenerate the lockfile. Do not modify the unrelated `token-speed` source or test.

- [x] **Step 3: Make the compiler contract reproducible**

Keep `typescript@5.9.3` in `devDependencies`, add `@earendil-works/pi-coding-agent: "*"` to peers, and exclude only `skills/systematic-debugging/condition-based-waiting-example.ts` because it is a pedagogical fragment with intentionally unresolved imports.

- [x] **Step 4: Correct Council's type contracts without changing behavior**

Use explicit `ok === false` discriminant checks for config and run outcomes. Type `GetApiKeyAndHeaders` from the non-null return type of Pi AI's `getModel`, and type the provider argument from `Parameters<typeof getModel>[0]` rather than passing an arbitrary string.

- [x] **Step 5: Verify GREEN**

Run:

```bash
npm run test:migration
npm exec -- tsc --noEmit
npx tsx extensions/council/council.test.ts
```

Expected: all three commands pass. `token-speed` compiles through the runtime peer contract without source edits.

- [x] **Step 6: Commit the TypeScript and Discord cleanup**

```bash
git add package.json package-lock.json tsconfig.json extensions/council tests/pi-subagents-migration.test.mjs
git add -u extensions/discord
git commit -m "refactor: remove discord and restore typecheck"
```

### Task 8: Migrate the Global Pi Installation Safely

**Files:**
- Modify via Pi commands: `~/.pi/agent/settings.json`
- Inspect only: npm manifests/tarballs for `pi-subagents@0.43.0` and `@getpipher/vision@0.5.2`

**Settings contract:** All top-level settings other than `packages` remain byte-for-byte equivalent as parsed JSON. The final package list contains the local checkout `/Users/nacho/Documents/GitHub/pi-tools`, `npm:pi-subagents@0.43.0`, `npm:@getpipher/vision@0.5.2`, and every unrelated prior package; it contains neither `npm:@tintinweb/pi-subagents` nor the stale GitHub clone of this package.

The local checkout replaces `git:github.com/Nachompiras/pi-tools` in global settings so the just-committed migration is active immediately without pushing to GitHub. Reinstalling the Git source is a separate post-push choice.

- [x] **Step 1: Snapshot global settings**

Run:

```bash
cp ~/.pi/agent/settings.json /tmp/pi-settings-before-subagents-migration.json
```

Expected: backup exists and parses as JSON. Never print credentials or unrelated settings values.

- [x] **Step 2: Inspect exact package metadata before installation**

Run:

```bash
npm view pi-subagents@0.43.0 name version license repository dist.integrity bin scripts dependencies peerDependencies --json
npm view @getpipher/vision@0.5.2 name version license repository dist.integrity bin scripts dependencies peerDependencies --json
npm pack pi-subagents@0.43.0 --dry-run --json
npm pack @getpipher/vision@0.5.2 --dry-run --json
```

Expected: names, versions, MIT licenses, and GitHub repositories match the reviewed sources; neither package defines `preinstall`, `install`, `postinstall`, or `prepare`; `pi-subagents` exposes only its documented `pi-subagents: install.mjs` CLI and Vision exposes no executable; dry-run contents correspond to their documented extension, skills/docs, agents, tests, and package metadata. Stop and report any mismatch.

- [x] **Step 3: Remove conflicting global packages/sources**

Run:

```bash
pi remove npm:@tintinweb/pi-subagents
pi remove git:github.com/Nachompiras/pi-tools
```

Expected: both old entries leave the package list. Do not restore Tintinweb as an automatic fallback if a later command fails.

- [x] **Step 4: Install the migrated checkout and pinned replacements**

Run:

```bash
pi install /Users/nacho/Documents/GitHub/pi-tools
pi install npm:pi-subagents@0.43.0
pi install npm:@getpipher/vision@0.5.2
```

Expected: all commands exit 0 and package installation resolves the local package's normal dependencies.

- [x] **Step 5: Verify settings preservation**

Compare `/tmp/pi-settings-before-subagents-migration.json` with `~/.pi/agent/settings.json` as parsed JSON. Assert every non-`packages` key is deeply equal; every unrelated old package remains; the three required package entries exist; and both obsolete entries are absent.

- [x] **Step 6: Verify Pi's installed-package view**

Run: `pi list`

Expected: output identifies the local `pi-tools`, pinned `pi-subagents@0.43.0`, pinned `@getpipher/vision@0.5.2`, and unrelated packages, with no Tintinweb package.

### Task 9: Run End-to-End Verification and Doctor

**Files:**
- Verify only: repository and global Pi installation

- [x] **Step 1: Verify a clean reproducible repository install**

Run:

```bash
rm -rf node_modules
npm ci
```

Expected: exit 0 using the committed lockfile.

- [x] **Step 2: Run all deterministic repository checks**

Run:

```bash
npm run test:migration
npm exec -- tsc --noEmit
npx tsx tests/token-speed.test.ts
git diff --check
git status --short
```

Expected: migration and token-speed tests pass, TypeScript exits 0, no whitespace errors appear, and only intentional uncommitted plan/checklist updates remain.

- [x] **Step 3: Confirm old active resources are absent**

Run:

```bash
rg -n '@tintinweb/pi-subagents|\bAgent\(|get_subagent_result|steer_subagent|subagent_type|isolation: "worktree"' README.md package.json package-lock.json agents prompts skills
find extensions -maxdepth 2 -type f -print | sort
```

Expected: the search returns no obsolete orchestration references; the extension list contains neither `image-label.ts` nor `image-describe/index.ts`.

- [x] **Step 4: Run the runtime doctor interactively**

Start `pi`, run `/reload`, then run `/subagents-doctor`.

Expected: Nicobailon's extension loads, package agents include `planner`, and doctor reports no installation, agent-discovery, tool-registration, or conflicting-runtime errors. If interactive automation is unavailable, stop short of claiming this check passed and give the user these exact commands.

- [x] **Step 5: Smoke-check vision ownership**

In the same Pi session, run `/vision` and inspect loaded resources through `pi config` if needed.

Expected: `@getpipher/vision@0.5.2` owns image labeling/delegation; no local `pi-tools` image extension is loaded. Do not send a real image unless the user accepts the configured provider cost/privacy implications.

- [x] **Step 6: Commit any final verification-only corrections**

If verification required tracked corrections, rerun Steps 1–3 and commit only those corrections:

```bash
git add README.md package.json package-lock.json agents prompts skills extensions tests
git commit -m "fix: complete pi-subagents migration verification"
```

Expected: no commit is created when verification requires no tracked correction.

### Task 10: Migrate Active Pi Imports to Earendil and Clear the Audit

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `extensions/council/index.ts`
- Modify: `extensions/council/openrouter.ts`
- Modify: `extensions/plan-mode/index.ts`
- Modify: `extensions/pokemon-buddy/index.ts`
- Test: `tests/pi-subagents-migration.test.mjs`
- Do not modify: `extensions/token-speed/`, `tests/token-speed.test.ts`

- [ ] **Step 1: Extend the namespace contract and verify RED**

Assert that active source, both manifests, and the lockfile contain no `@mariozechner/pi-` reference. Assert that the four imported `@earendil-works/pi-*` core packages are declared as `*` peers. Run the migration test and confirm it fails on the current Mario imports/peers.

- [ ] **Step 2: Migrate imports and peer dependencies**

Replace the seven active Mario import specifiers with their Earendil equivalents. Replace old peers with `@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, and `@earendil-works/pi-tui`; retain TypeScript 5.9.3 and package resources unchanged. Regenerate the lockfile.

- [ ] **Step 3: Resolve only API/type differences exposed by the current Pi packages**

Run TypeScript and make the smallest behavior-preserving corrections required by Earendil 0.84.1. Do not alter the separately owned token-speed implementation.

- [ ] **Step 4: Verify runtime, tests, and security**

Run:

```bash
npm ci
npm run test:migration
npm exec -- tsc --noEmit
npx tsx tests/token-speed.test.ts
npx tsx extensions/council/council.test.ts
npm audit --omit=dev
pi --mode json -p '/subagents-doctor'
```

Expected: tests and typecheck pass; Council's live E2E passes; production audit reports zero vulnerabilities; doctor discovers 6 builtin and 5 package agents with async and supervisor support.

- [ ] **Step 5: Commit the namespace migration**

```bash
git add package.json package-lock.json extensions/council extensions/plan-mode/index.ts extensions/pokemon-buddy/index.ts tests/pi-subagents-migration.test.mjs docs/superpowers
git commit -m "refactor: migrate pi imports to earendil"
```
