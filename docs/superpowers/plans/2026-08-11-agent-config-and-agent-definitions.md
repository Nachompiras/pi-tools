# Agent Config and Agent Definitions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the finalized local `agent-config` extension and eight custom agent definitions into `pi-tools`, verify them, and prepare a pull request.

**Architecture:** Import the standalone extension as `extensions/agent-config/` while moving package-level dependency and script ownership to the `pi-tools` root manifest. Treat the local agent Markdown files as canonical import inputs, preserve Tintinweb 0.15.x frontmatter, and exclude nested repository/generated artifacts.

**Tech Stack:** TypeScript, Pi extension API, `@earendil-works/pi-tui`, `@tintinweb/pi-subagents` 0.15.x, YAML, Vitest, Node test runner, npm.

---

## File Structure

- `extensions/agent-config/index.ts`: Pi command registration and UI orchestration.
- `extensions/agent-config/src/*.ts`: discovery, frontmatter, models, persistence, selector, adapter, and workflow units.
- `extensions/agent-config/test/*.test.ts`: extension behavior and integration tests.
- `extensions/agent-config/README.md`: installation, command, compatibility, and safety documentation.
- `extensions/agent-config/tsconfig.json`: extension type-check boundary.
- `agents/*.md`: eight packaged Tintinweb-compatible agent definitions.
- `package.json` / `package-lock.json`: runtime dependencies and root verification scripts.
- `README.md`: package feature and agent documentation.
- `tests/tintinweb-subagents-restoration.test.mjs`: packaged-agent and integration contract coverage.

### Task 1: Import Agent Definitions and Enforce Their Contract

**Files:**
- Modify: `agents/explore.md`
- Modify: `agents/planner.md`
- Modify: `agents/reviewer.md`
- Modify: `agents/scout.md`
- Modify: `agents/worker.md`
- Create: `agents/quick-worker.md`
- Create: `agents/deep-worker.md`
- Create: `agents/deep-reviewer.md`
- Modify: `tests/tintinweb-subagents-restoration.test.mjs`

**Contract:** Agent names are inferred from filenames. Frontmatter may use `description`, `tools`, `model`, `thinking`, `max_turns`, and `prompt_mode`; it must not use Nicobailon fields or unsupported built-in tools.

**References:** Finalized sources under `~/.pi/agent/agents/`; Tintinweb 0.15.x custom-agent format; design document agent-set section.

- [ ] **Step 1: Extend the package contract test**

Require all eight filenames, Tintinweb-compatible frontmatter, supported built-in tools, and the expected bounded `thinking`/`max_turns` values. Verify `quick-worker`, `deep-worker`, and `deep-reviewer` are packaged.

- [ ] **Step 2: Run the focused contract test and verify failure**

Run: `npm run test:subagents`
Expected: FAIL because the three new definitions and updated metadata are absent.

- [ ] **Step 3: Import the finalized definitions**

Copy only the eight `.md` sources. Exclude `.bak` files and ensure `explore` contains no `multi_grep`.

- [ ] **Step 4: Run the focused contract test and verify success**

Run: `npm run test:subagents`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agents tests/tintinweb-subagents-restoration.test.mjs
git commit -m "feat: add bounded agent definitions"
```

### Task 2: Import and Integrate the Agent Config Extension

**Files:**
- Create: `extensions/agent-config/index.ts`
- Create: `extensions/agent-config/src/*.ts`
- Create: `extensions/agent-config/test/*.test.ts`
- Create: `extensions/agent-config/README.md`
- Create: `extensions/agent-config/tsconfig.json`
- Modify: `package.json`
- Modify: `package-lock.json`

**Contract:** `extensions/agent-config/index.ts` remains the extension entrypoint and registers `/agent-config`. Runtime imports must resolve from the root package install. Root scripts must expose focused extension tests and type checking, and the root `test` command must include the extension suite.

**References:** Tracked files from `~/.pi/agent/extensions/agent-config`; Pi package and extension documentation; root package conventions; `@tintinweb/pi-subagents` 0.15.x.

- [ ] **Step 1: Import distributable extension files**

Copy tracked runtime, source, tests, README, and TypeScript configuration. Exclude `.git/`, `node_modules/`, the standalone manifest/lockfile, and `docs/` historical development material.

- [ ] **Step 2: Add root package integration tests/scripts first**

Add root commands for focused agent-config tests and type checking, and include the focused test suite in `npm test`. Add a contract assertion that the extension entrypoint and runtime dependency declarations exist.

- [ ] **Step 3: Run focused verification and observe integration failure**

Run the new root agent-config test/typecheck commands.
Expected: initial failure from unresolved/missing root dependencies or stale standalone assumptions.

- [ ] **Step 4: Integrate dependencies and compatibility**

Add `yaml` as a runtime dependency and Vitest plus Node types as development dependencies. Use root Pi peer dependencies rather than duplicating the standalone package. Align built-in discovery and docs with Tintinweb 0.15.x while preserving the tested extension behavior.

- [ ] **Step 5: Install and run focused verification**

Run: `npm install`
Run the root agent-config test and typecheck commands.
Expected: all extension tests and type checking pass.

- [ ] **Step 6: Commit**

```bash
git add extensions/agent-config package.json package-lock.json tests
git commit -m "feat: add agent config extension"
```

### Task 3: Document and Validate Package Integration

**Files:**
- Modify: `README.md`
- Modify: `extensions/agent-config/README.md`
- Modify: `tests/tintinweb-subagents-restoration.test.mjs`

**Contract:** Root documentation lists all eight agents and the `/agent-config` extension. Installation guidance describes package-based loading and Tintinweb 0.15.x compatibility without standalone-clone instructions that conflict with `pi-tools`.

**References:** Existing root README tables; imported extension README; design compatibility and delivery sections.

- [ ] **Step 1: Add documentation contract assertions**

Require the root README to mention `agent-config`, `/agent-config`, all three new agent names, and current Tintinweb compatibility.

- [ ] **Step 2: Run the focused contract and verify failure**

Run: `npm run test:subagents`
Expected: FAIL because root documentation has not yet been updated.

- [ ] **Step 3: Update documentation**

Add the extension to the included-features table, document command usage and safety at package level, expand the agent table, and remove stale standalone installation/version wording from the imported README.

- [ ] **Step 4: Run focused tests and verify success**

Run: `npm run test:subagents`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add README.md extensions/agent-config/README.md tests/tintinweb-subagents-restoration.test.mjs
git commit -m "docs: document agent configuration"
```

### Task 4: Final Verification and Pull Request

**Files:**
- Modify only if verification reveals a reproduced integration defect.

- [ ] **Step 1: Run complete automated verification**

Run focused extension tests, extension type checking, `npm test`, and `git diff --check`.
Expected: all pass with no warnings indicating broken configuration.

- [ ] **Step 2: Run a local Pi smoke test**

Load the worktree package in a representative Pi invocation and verify the extension loads and `/agent-config` is registered without mutating the active global setup. If interactive command enumeration cannot be automated, record the exact bounded manual check performed.

- [ ] **Step 3: Review branch contents**

Confirm no nested `.git`, `node_modules`, standalone package files, historical extension docs, or backup agents are tracked. Review the diff against `main` for scope and secrets.

- [ ] **Step 4: Perform one focused code review**

Review only concrete correctness, packaging, and compatibility issues. Fix blocking findings once and rerun focused/full verification.

- [ ] **Step 5: Push and open the PR**

```bash
git push -u origin feature/agent-config
gh pr create --base main --head feature/agent-config
```

Include scope, compatibility notes, and exact verification results in the PR body.
