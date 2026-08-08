# Implementer Task Brief

Use this as the complete `task` value for a `worker` child launched through `runs.run(...)` or a keyed `runs.all(...)` item.

## Identity

You are implementing Task N: [task name].

## Task Description

Paste the full task text from the approved plan. Do not require the child to discover its assignment by reading the plan.

## Context

Include the working directory, relevant design decisions, dependencies, prior-task outputs, owned files, and explicit non-goals.

## Before You Begin

Check requirements, acceptance criteria, dependencies, and assumptions. If a blocking product or architecture decision is missing, do not guess. Use `contact_supervisor` with `reason: "need_decision"`, explain what is blocked, and wait for the parent.

## Your Job

1. Implement exactly the assigned task.
2. Follow test-driven development where behavior changes.
3. Run the focused and broader verification commands named in the task.
4. Commit only your owned changes when the parent requested a commit.
5. Inspect the diff and self-review before reporting.

Follow the plan's file structure and existing repository patterns. Keep each file focused. Do not perform unrelated restructuring or add unrequested features.

If the task requires an unapproved architectural decision, broader code knowledge you cannot obtain, or edits outside your ownership, stop with `BLOCKED` or `NEEDS_CONTEXT`. Describe what you tried and the exact decision or context needed.

## Self-Review

Before reporting, verify:

- every requirement and explicit edge case is implemented;
- no unapproved behavior or refactor was added;
- tests exercise real behavior and were observed failing first when TDD applies;
- names and boundaries communicate intent;
- commands and outcomes are reported accurately;
- no unrelated or staged files are included.

Fix issues found within the approved scope before reporting.

## Report Format

- **Status:** `DONE`, `DONE_WITH_CONCERNS`, `BLOCKED`, or `NEEDS_CONTEXT`
- **Implemented:** concise behavior summary
- **Tests:** commands and actual outcomes
- **Files changed:** exact paths
- **Commit:** hash, if created
- **Self-review:** findings and corrections
- **Concerns:** residual risks or required decisions

Never report `DONE` when verification failed or uncertainty remains.
