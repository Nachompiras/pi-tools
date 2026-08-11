# Tintinweb Subagents Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore `@tintinweb/pi-subagents` and its orchestration API without reverting Vision, Earendil, token-speed, council, Discord removal, or any global Pi configuration.

**Architecture:** Use commit `36a94c9` only as the behavioral reference for Tintinweb-specific content, then apply targeted edits to the current tree. A repository contract test will make the desired dependency, agent frontmatter, active workflow API, historical-document status, and preserved unrelated behavior explicit.

**Tech Stack:** Pi packages, npm, Node.js built-in test runner, Markdown skills/prompts, YAML frontmatter, TypeScript.

---

## Scope and File Map

This is one cohesive subsystem restoration; it does not require splitting into separate plans.

- `tests/tintinweb-subagents-restoration.test.mjs` — static contract for the restored runtime and preserved unrelated migrations.
- `package.json` and `package-lock.json` — dependency, test-script, and package metadata wiring.
- `agents/*.md` — Tintinweb-compatible custom-agent frontmatter.
- `prompts/*.md` — short end-user pipelines expressed with `Agent()`.
- `skills/dispatching-parallel-agents/SKILL.md`, `skills/using-superpowers/SKILL.md`, and `skills/executing-plans/SKILL.md` — primary runtime guidance.
- `skills/subagent-driven-development/` — implementation and two-stage review workflow.
- `skills/auditing-codebase/procedure.md` and `skills/improve-codebase-architecture/` — specialized orchestration consumers.
- `README.md` — current installation and custom-agent setup guidance while retaining Vision and current extensions.
- `docs/superpowers/specs/2026-08-07-pi-subagents-and-vision-migration-design.md`, `docs/superpowers/plans/2026-08-07-pi-subagents-and-vision-migration.md`, and `tasks/todo.md` — historical status chain.

**Primary references:**

- Approved design: `docs/superpowers/specs/2026-08-10-tintinweb-subagents-restoration-design.md`
- Last pre-Nicobailon repository state: commit `36a94c9`
- Current migration contract to replace: `tests/pi-subagents-migration.test.mjs`

### Task 1: Define the Tintinweb restoration contract

**Files:**
- Delete: `tests/pi-subagents-migration.test.mjs`
- Create: `tests/tintinweb-subagents-restoration.test.mjs`
- Modify: `package.json`

**Contract:**

The replacement Node test file must organize independent assertions with these exact names and observable behaviors:

- `package selects Tintinweb and preserves current package contracts` — the manifest and lockfile select `@tintinweb/pi-subagents`, reject Nicobailon's standalone `pi-subagents`, and preserve unrelated package contracts;
- `agents use Tintinweb frontmatter` — custom-agent frontmatter uses Tintinweb fields;
- `primary workflows use Tintinweb` — packaged prompts and primary dispatch guidance use Tintinweb tools and reject Nicobailon workflow syntax;
- `subagent-driven development uses Tintinweb` — the implementation/review workflow and role prompts use Tintinweb tools;
- `specialized workflows use Tintinweb` — audit and architecture consumers use Tintinweb tools;
- `README documents Tintinweb and preserves current features` — current setup identifies Tintinweb while retaining Vision, token-speed, and council guidance;
- `Nicobailon migration is historical` — the 2026-08-07 migration documents point to the approved 2026-08-10 restoration design;
- `removed runtimes stay removed` — Earendil peers remain, while Discord and local image extensions remain absent.

Keep recursive resource helpers only where needed. Do not scan historical plans/specifications as active workflow guidance, and use an explicit active-orchestration path list so incidental prose in unrelated skills cannot create false positives.

- [ ] **Step 1: Replace the old migration test with a failing restoration contract**

Rename the test around the new behavior and write separate named test cases for package wiring, agent frontmatter, active API syntax, current documentation, historical status, and preserved unrelated work. Assert exact manifest fields where they are contracts and semantic markers where files are documentation.

- [ ] **Step 2: Point the npm scripts at the new contract**

Replace `test:migration` with `test:subagents`, update the aggregate `test` command accordingly, and retain the council and token-speed scripts unchanged.

- [ ] **Step 3: Run the contract to verify the red state**

Run: `npm run test:subagents`

Expected: FAIL because the repository still declares Nicobailon discovery/frontmatter and documents `workflowScript`; the preserved-work assertions should already pass.

- [ ] **Step 4: Commit the red contract**

```bash
git add package.json tests/pi-subagents-migration.test.mjs tests/tintinweb-subagents-restoration.test.mjs
git commit -m "test: define tintinweb restoration contract"
```

### Task 2: Restore package wiring and custom-agent compatibility

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `agents/explore.md`
- Modify: `agents/planner.md`
- Modify: `agents/reviewer.md`
- Modify: `agents/scout.md`
- Modify: `agents/worker.md`
- Test: `tests/tintinweb-subagents-restoration.test.mjs`

**Manifest contract:**

```json
{
  "dependencies": {
    "@tintinweb/pi-subagents": "^0.5.2"
  }
}
```

The current `type`, scripts, Pi extension/skill/prompt exports, Earendil peer dependencies, and TypeScript/tsx development dependencies remain. The `pi.subagents` object is removed.

**Agent-frontmatter contract:**

- No custom agent contains Nicobailon's explicit `name` field.
- `agents/worker.md` contains `prompt_mode: append` and not `systemPromptMode`.
- Existing descriptions, tools, model selections, and prompt bodies remain unchanged.

- [ ] **Step 1: Run the package and frontmatter contract cases alone**

Run: `node --test --test-name-pattern="package selects Tintinweb|agents use Tintinweb" tests/tintinweb-subagents-restoration.test.mjs`

Expected: FAIL on the missing dependency, `pi.subagents`, explicit agent names, and worker prompt mode.

- [ ] **Step 2: Update the manifest without disturbing current package metadata**

Add the dependency contract, remove only `pi.subagents`, and retain all unrelated current fields. Do not restore Discord or Mario Zechner peer dependencies from `36a94c9`.

- [ ] **Step 3: Restore Tintinweb-compatible agent frontmatter**

Use the same files at `36a94c9` as the frontmatter reference. Make only runtime-compatibility edits; preserve current agent bodies and model choices.

- [ ] **Step 4: Regenerate the lockfile from the current manifest**

Run: `npm install`

Expected: exit 0; local dependencies are synchronized, `package-lock.json` resolves `node_modules/@tintinweb/pi-subagents`, has no top-level `node_modules/pi-subagents` package entry, retains Earendil packages, and does not restore Discord.

- [ ] **Step 5: Run the focused contract cases**

Run: `node --test --test-name-pattern="package selects Tintinweb|agents use Tintinweb" tests/tintinweb-subagents-restoration.test.mjs`

Expected: PASS for both selected cases.

- [ ] **Step 6: Commit package and agent restoration**

```bash
git add package.json package-lock.json agents tests/tintinweb-subagents-restoration.test.mjs
git commit -m "refactor: restore tintinweb package integration"
```

### Task 3: Restore primary dispatch guidance and packaged prompts

**Files:**
- Modify: `prompts/implement.md`
- Modify: `prompts/implement-and-review.md`
- Modify: `prompts/scout-and-plan.md`
- Modify: `skills/dispatching-parallel-agents/SKILL.md`
- Modify: `skills/using-superpowers/SKILL.md`
- Modify: `skills/executing-plans/SKILL.md`
- Test: `tests/tintinweb-subagents-restoration.test.mjs`

**Behavior:**

- Packaged prompts dispatch named roles through foreground `Agent({ subagent_type, prompt, description })` calls and pass prior result text into dependent prompts.
- Parallel-dispatch guidance launches independent agents with `run_in_background: true`, collects every returned ID through `get_subagent_result({ agent_id, wait: true })`, steers with `steer_subagent({ agent_id, message })`, and documents `isolation: "worktree"` for parallel writers.
- `using-superpowers` and `executing-plans` identify `@tintinweb/pi-subagents` and its tool names, with their existing non-subagent fallback guidance retained.
- These files contain no `workflowScript`, `runs.run`, `runs.all`, `subagent_wait`, or Nicobailon package references.

**References:** Compare each target against the same path at `36a94c9`. Restore only sections changed by commits `faeefb7` and `9e04521`; retain unrelated current wording if any later history changed it.

- [ ] **Step 1: Run the focused active-API contract**

Run: `node --test --test-name-pattern="primary workflows use Tintinweb" tests/tintinweb-subagents-restoration.test.mjs`

Expected: FAIL because these files currently use Nicobailon's workflow API.

- [ ] **Step 2: Restore the three packaged prompt pipelines**

Re-express scout/plan/implement and implement/review sequences with foreground `Agent()` calls. Ensure each downstream prompt receives the preceding result rather than assuming shared context.

- [ ] **Step 3: Restore parallel dispatch semantics**

Use the pre-migration skill as the behavioral source for foreground chaining, background fan-out, result collection, steering, worktree isolation, model selection, progress, failure handling, and anti-pattern guidance. Remove Nicobailon-only builtins, actions, workflow scripts, and supervisor-channel instructions.

- [ ] **Step 4: Align generic skill references**

Update only the subagent-runtime paragraphs in `using-superpowers` and `executing-plans` to name Tintinweb and its three tools.

- [ ] **Step 5: Run the focused active-API contract again**

Run: `node --test --test-name-pattern="primary workflows use Tintinweb" tests/tintinweb-subagents-restoration.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit the primary workflow restoration**

```bash
git add prompts skills/dispatching-parallel-agents/SKILL.md skills/using-superpowers/SKILL.md skills/executing-plans/SKILL.md tests/tintinweb-subagents-restoration.test.mjs
git commit -m "docs: restore tintinweb dispatch workflows"
```

### Task 4: Restore subagent-driven implementation and review workflows

**Files:**
- Modify: `skills/subagent-driven-development/SKILL.md`
- Modify: `skills/subagent-driven-development/implementer-prompt.md`
- Modify: `skills/subagent-driven-development/spec-reviewer-prompt.md`
- Modify: `skills/subagent-driven-development/code-quality-reviewer-prompt.md`
- Test: `tests/tintinweb-subagents-restoration.test.mjs`

**Behavior:**

The skill must again describe the Tintinweb lifecycle for each task:

1. classify tasks by file independence;
2. dispatch independent implementers in the background or dependent implementers in the foreground with `Agent()`;
3. collect every background result with `get_subagent_result()`;
4. answer in-flight questions with `steer_subagent()`;
5. run spec-compliance review before code-quality review;
6. re-dispatch fixes and re-review until each gate passes;
7. preserve per-task testing, commits, self-review, and final-review discipline.

The three prompt references must show their expected invocation through Tintinweb's `Agent()` API and must not teach nested `runs.run`/resume workflows or supervisor contacts.

**References:** Use all four files at `36a94c9` as the intended workflow baseline. Preserve only current content that is demonstrably runtime-independent and still consistent with the approved design.

- [ ] **Step 1: Run the subagent-development contract case**

Run: `node --test --test-name-pattern="subagent-driven development uses Tintinweb" tests/tintinweb-subagents-restoration.test.mjs`

Expected: FAIL on Nicobailon workflow and supervisor syntax.

- [ ] **Step 2: Restore the main skill's execution graph and instructions**

Restore foreground and parallel branches, explicit result collection, the two review gates, fix loops, model precedence, question handling, and red-flag guidance using Tintinweb tool shapes.

- [ ] **Step 3: Restore the three role prompt contracts**

Align implementer, spec reviewer, and quality reviewer prompt documents with foreground `Agent()` dispatch. Ensure each prompt remains role-specific and receives all needed task text, implementation report, paths, and commit SHAs explicitly.

- [ ] **Step 4: Run the focused contract case again**

Run: `node --test --test-name-pattern="subagent-driven development uses Tintinweb" tests/tintinweb-subagents-restoration.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit the development workflow restoration**

```bash
git add skills/subagent-driven-development tests/tintinweb-subagents-restoration.test.mjs
git commit -m "docs: restore tintinweb development workflow"
```

### Task 5: Restore specialized orchestration consumers

**Files:**
- Modify: `skills/auditing-codebase/procedure.md`
- Modify: `skills/improve-codebase-architecture/SKILL.md`
- Modify: `skills/improve-codebase-architecture/INTERFACE-DESIGN.md`
- Test: `tests/tintinweb-subagents-restoration.test.mjs`

**Behavior:**

- The audit procedure dispatches each auditor in the background through `Agent()`, records every returned agent ID and model label, collects all results through `get_subagent_result(wait: true)`, then dispatches peer rankers and the judge through the same runtime.
- Architecture exploration uses a foreground Tintinweb agent with the intended exploration role.
- Interface design launches at least three independent background workers, collects all results, and preserves the requirement for radically different interfaces.
- Failure tolerance remains explicit: failed audit agents are reported, successful survivors continue where the existing audit procedure permits it, and missing result collection is never treated as success.
- Nicobailon workflow scripts and `runs.*` calls are absent from all three files.

**References:** Use these paths at `36a94c9` for API shapes, but retain current domain-specific audit and architecture requirements that were not introduced solely for Nicobailon.

- [ ] **Step 1: Run the specialized-consumer contract case**

Run: `node --test --test-name-pattern="specialized workflows use Tintinweb" tests/tintinweb-subagents-restoration.test.mjs`

Expected: FAIL on current `subagent({ workflowScript })` and `runs.*` instructions.

- [ ] **Step 2: Restore the audit dispatch and collection stages**

Translate only orchestration mechanics back to Tintinweb. Keep auditor prompt construction, anonymized ranking, judge responsibilities, artifact paths, budget reporting, and verification rules intact.

- [ ] **Step 3: Restore architecture exploration and interface fan-out**

Replace workflow-script examples with the corresponding foreground and background `Agent()` calls and explicit result collection. Preserve the existing architecture-analysis criteria and output expectations.

- [ ] **Step 4: Run the focused contract case again**

Run: `node --test --test-name-pattern="specialized workflows use Tintinweb" tests/tintinweb-subagents-restoration.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit the specialized workflow restoration**

```bash
git add skills/auditing-codebase/procedure.md skills/improve-codebase-architecture tests/tintinweb-subagents-restoration.test.mjs
git commit -m "docs: restore tintinweb specialized workflows"
```

### Task 6: Update current setup guidance and historical status

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-07-pi-subagents-and-vision-migration-design.md`
- Modify: `docs/superpowers/plans/2026-08-07-pi-subagents-and-vision-migration.md`
- Modify: `tasks/todo.md`
- Test: `tests/tintinweb-subagents-restoration.test.mjs`

**Current-documentation behavior:**

- README installs Tintinweb without an exact version in the user command: `pi install npm:@tintinweb/pi-subagents`.
- README keeps the pinned Vision command and explanation unchanged in meaning.
- README explains global and project-local copying of `agents/*.md` because `pi.subagents.agents` discovery no longer exists.
- README describes Tintinweb tools and relevant built-in roles without claiming package-priority discovery from Nicobailon.
- Current sections for Vision, plan-mode, council, token-speed, skills, and update commands remain.

**Historical-document behavior:**

Both 2026-08-07 migration documents must start with a prominent historical/reverted notice linking to `docs/superpowers/specs/2026-08-10-tintinweb-subagents-restoration-design.md`. `tasks/todo.md` remains historical, but its supersession note must explain that the later Nicobailon migration was itself reverted by the 2026-08-10 restoration.

- [ ] **Step 1: Run documentation and historical-status contract cases**

Run: `node --test --test-name-pattern="README documents Tintinweb|Nicobailon migration is historical" tests/tintinweb-subagents-restoration.test.mjs`

Expected: FAIL because README still presents Nicobailon as current and the 2026-08-07 documents are not marked reverted.

- [ ] **Step 2: Restore README dependency and agent-setup guidance selectively**

Use the dependency and copy instructions from `README.md` at `36a94c9` as the Tintinweb reference. Merge them into the current README rather than replacing the whole file, so Vision, token-speed, council, and all other current content survive.

- [ ] **Step 3: Mark the Nicobailon design and plan as historical**

Add an unambiguous notice at the beginning of each 2026-08-07 document. Do not rewrite their historical bodies; they must continue to record what was implemented at that time.

- [ ] **Step 4: Correct the historical chain in `tasks/todo.md`**

Keep the file explicitly historical and record both facts: it describes the earlier Tintinweb migration, and the later Nicobailon replacement was reverted by the approved 2026-08-10 restoration.

- [ ] **Step 5: Run the focused documentation cases again**

Run: `node --test --test-name-pattern="README documents Tintinweb|Nicobailon migration is historical" tests/tintinweb-subagents-restoration.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit current and historical documentation**

```bash
git add README.md docs/superpowers/specs/2026-08-07-pi-subagents-and-vision-migration-design.md docs/superpowers/plans/2026-08-07-pi-subagents-and-vision-migration.md tasks/todo.md tests/tintinweb-subagents-restoration.test.mjs
git commit -m "docs: make tintinweb current subagent runtime"
```

### Task 7: Run complete verification and audit the selective rollback

**Files:**
- Verify: all files changed since `d18a1ec`
- Test: `tests/tintinweb-subagents-restoration.test.mjs`

- [ ] **Step 1: Run the complete restoration contract**

Run: `npm run test:subagents`

Expected: all package, frontmatter, active API, README, historical-status, and preserved-work cases PASS.

- [ ] **Step 2: Verify the installed dependency graph**

Run: `npm ls @tintinweb/pi-subagents`

Expected: exit 0 and a resolved Tintinweb version satisfying `^0.5.2`.

Run: `npm ls pi-subagents`

Expected: no top-level Nicobailon package is installed. Treat npm's empty-tree exit status as acceptable only when the output confirms `(empty)`; do not confuse the scoped Tintinweb package with the standalone package.

- [ ] **Step 3: Run the complete automated suite**

Run: `npm test`

Expected: restoration contract, council adapter tests, and token-speed tests all PASS.

- [ ] **Step 4: Run TypeScript validation**

Run: `npx tsc --noEmit`

Expected: exit 0 with no diagnostics.

- [ ] **Step 5: Search active workflow surfaces for mixed-runtime residue**

Run a repository search limited to `README.md`, `prompts/`, the primary subagent skills, and the specialized consumer files for `workflowScript`, `runs.run`, `runs.all`, `subagent_wait`, `systemPromptMode`, and current Nicobailon setup commands.

Expected: no matches in active guidance. Historical 2026-08-07 documents may retain these terms only beneath their reverted notices.

- [ ] **Step 6: Audit the changed-file set and protected behavior**

Run: `git diff --name-status d18a1ec..HEAD`

Expected: changes are limited to the plan plus the files named in Tasks 1–6. In particular, there are no recreated `extensions/image-label.ts`, `extensions/image-describe/`, `extensions/discord/`, or `tests/image-label.test.ts` paths and no modifications to council or token-speed implementation files.

Run: `git diff --check d18a1ec..HEAD`

Expected: exit 0 with no whitespace errors.

- [ ] **Step 7: Confirm repository-only scope and a clean worktree**

Run: `git status --short --branch`

Expected: no staged or unstaged files. Review the command history and diff to confirm no command in this plan wrote beneath `~/.pi/`.

## Completion Criteria

- Tintinweb is the only active subagent runtime in package metadata and current guidance.
- Its dependency remains updateable through the approved `^0.5.2` range rather than an exact pin.
- All active orchestration uses `Agent()`, `get_subagent_result()`, and `steer_subagent()`.
- Custom agents are compatible with Tintinweb discovery after manual global or project-local copying.
- Vision, Earendil, token-speed, council, and Discord removal are preserved.
- The complete test suite and TypeScript validation pass.
- No global Pi configuration was modified.
