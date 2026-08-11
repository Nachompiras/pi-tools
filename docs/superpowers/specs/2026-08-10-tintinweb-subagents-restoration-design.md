# Tintinweb Subagents Restoration Design

**Date:** 2026-08-10
**Status:** Approved

## Goal

Restore `@tintinweb/pi-subagents` as the repository's only subagent runtime while preserving all unrelated changes made after the migration to Nicobailon's `pi-subagents`.

The restoration applies only to this repository. It must not edit the user's global Pi configuration; a later package update will handle the installed repository state.

## Decision

Perform a selective semantic rollback to the repository state immediately before the Nicobailon migration (`36a94c9`) for subagent-specific behavior only. Do not revert whole commits because later commits mix subagent changes with Vision, token-speed, Earendil, council, Discord removal, and other work that must remain.

Alternative approaches were rejected:

- Reverting complete commits risks removing unrelated improvements.
- Supporting both subagent runtimes would duplicate instructions and leave agents uncertain about which API to use.

## Runtime and Dependency

`@tintinweb/pi-subagents` becomes the only documented and supported subagent runtime.

- Declare `@tintinweb/pi-subagents` as a regular dependency with the non-pinned compatible range `^0.5.2`.
- Regenerate `package-lock.json` from the current manifest rather than restoring an old lockfile.
- Preserve current Earendil peer dependencies and current development dependencies.
- Remove the Nicobailon-specific `pi.subagents.agents` manifest entry.
- Do not add a compatibility shim or retain instructions for Nicobailon's workflow API.

## Agent Definitions

Keep the custom definitions in `agents/`, but restore the frontmatter expected by Tintinweb:

- remove the Nicobailon-specific explicit `name` fields;
- restore `prompt_mode: append` where applicable instead of `systemPromptMode`;
- preserve agent prompts and model choices that are unrelated to runtime compatibility.

Because Tintinweb does not discover agents through `pi.subagents.agents`, the README must again explain how to copy `agents/*.md` into the global `~/.pi/agent/agents/` directory or a project-local `.pi/agents/` directory.

## Active Workflow API

All active skills, prompt templates, examples, and workflow instructions must use Tintinweb's public tools:

- `Agent()` for foreground and background dispatch;
- `get_subagent_result()` for collecting background results;
- `steer_subagent()` for steering running agents;
- Tintinweb fields such as `subagent_type`, `run_in_background`, and `isolation: "worktree"` where appropriate.

Active instructions must not use Nicobailon's `subagent({ workflowScript })`, `runs.run`, `runs.all`, `subagent_wait`, or workflow management actions.

The affected active surfaces include:

- `prompts/implement.md`;
- `prompts/implement-and-review.md`;
- `prompts/scout-and-plan.md`;
- `skills/dispatching-parallel-agents/SKILL.md`;
- `skills/subagent-driven-development/`;
- `skills/using-superpowers/SKILL.md`;
- `skills/executing-plans/SKILL.md`;
- subagent orchestration instructions in `skills/auditing-codebase/` and `skills/improve-codebase-architecture/`.

## Documentation

Update current README and skill guidance to identify Tintinweb as the required runtime and show its API.

Historical plans and specifications may retain references to either library when describing past work. The 2026-08-07 migration documents must be clearly marked as reverted or superseded so they cannot be mistaken for current setup instructions.

## Preserved Work

The restoration must not change:

- `@getpipher/vision` guidance or restore the removed local image extensions;
- Earendil imports and peer dependencies;
- token-speed;
- council behavior or tests;
- Discord removal;
- unrelated skills, prompts, or documentation;
- global files under `~/.pi/`.

## Failure Handling

The restoration targets the previously working Tintinweb API rather than introducing fallback behavior. If the currently resolved Tintinweb release is incompatible with the restored API, dependency installation or contract verification must fail visibly. The implementation must not silently fall back to Nicobailon or add dual-runtime instructions.

## Verification

Replace the Nicobailon migration contract with a Tintinweb restoration contract that verifies:

1. `package.json` declares `@tintinweb/pi-subagents` with `^0.5.2` and contains no `pi.subagents` configuration.
2. `package-lock.json` resolves Tintinweb and contains no Nicobailon `pi-subagents` package.
3. Custom agent frontmatter is compatible with Tintinweb.
4. Active skills and prompts use `Agent()`, `get_subagent_result()`, and `steer_subagent()` where required.
5. Active instructions contain no Nicobailon workflow API or current setup guidance.
6. README documents Tintinweb agent installation while preserving Vision, token-speed, council, and current package guidance.
7. The complete test suite and TypeScript checks pass.
8. A final diff audit confirms that Vision, Earendil, token-speed, council, and Discord removal remain unchanged.

No automated step may modify the user's global Pi settings.
