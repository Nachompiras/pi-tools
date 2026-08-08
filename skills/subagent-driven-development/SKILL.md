---
name: subagent-driven-development
description: Use when executing implementation plans with independent tasks in the current session
---

# Subagent-Driven Development

Execute an approved plan with focused children and independent review after every implementation slice.

**Core principle:** one clear writer per workspace, fresh spec review, then fresh quality review.

## When to Use

Use this skill when:

- an approved implementation plan already exists;
- tasks have explicit files, behavior, and verification;
- independent tasks can be isolated safely;
- the parent remains responsible for decisions and final integration.

Use `executing-plans` instead when subagents are unavailable. Return to brainstorming or planning when requirements are unresolved.

## Required Flow

1. Read the plan and extract every task with its full text.
2. Map dependencies and file overlap.
3. Dispatch one writer for a dependent task, or one coordinated parallel batch for independent tasks.
4. Inspect worker evidence and the actual repository state.
5. Dispatch a fresh spec reviewer.
6. Fix and re-review any specification gap.
7. Dispatch a fresh code-quality reviewer.
8. Fix and re-review any quality issue.
9. Mark the task complete only after both gates pass.
10. After all tasks, dispatch a final reviewer for the complete diff.
11. Use `finishing-a-development-branch`.

Do not start quality review before spec compliance passes. Do not trust a worker summary without checking files and verification output.

## Single Dependent Task

Use the full task brief from [implementer-prompt.md](implementer-prompt.md):

```js
subagent({
  workflowScript: `
    return runs.run("task-4-implementation", {
      agent: "worker",
      task: IMPLEMENTER_BRIEF
    });
  `,
  async: false
})
```

After inspecting the implementation, launch a fresh spec reviewer with the original task, base/head scope, and worker evidence:

```js
subagent({
  workflowScript: `
    return runs.run("task-4-spec-review", {
      agent: "reviewer",
      task: SPEC_REVIEW_BRIEF
    });
  `,
  async: false,
  context: "fresh"
})
```

If spec review passes, launch a different fresh reviewer using [code-quality-reviewer-prompt.md](code-quality-reviewer-prompt.md). If either review finds issues, dispatch a narrowly scoped worker fix and repeat only the failed gate.

## Independent Task Batch

Parallelize only tasks with disjoint ownership. Use managed worktrees for parallel writers:

```js
subagent({
  workflowScript: `
    const implementations = await runs.all([
      {
        key: "task-1-hooks",
        agent: "worker",
        task: TASK_1_IMPLEMENTER_BRIEF,
        worktree: true
      },
      {
        key: "task-2-recovery",
        agent: "worker",
        task: TASK_2_IMPLEMENTER_BRIEF,
        worktree: true
      },
      {
        key: "task-3-config",
        agent: "worker",
        task: TASK_3_IMPLEMENTER_BRIEF,
        worktree: true
      }
    ]);
    return implementations.map(result => ({
      key: result.key,
      output: result.output,
      artifacts: result.artifactPaths
    }));
  `,
  async: false
})
```

Inspect each handoff separately before applying it. After integration, run spec reviewers in one read-only `runs.all(...)` batch, fix failures, and then run a separate quality-review batch. Unique keys must preserve task-to-result mapping.

Do not place dependent writers in one batch. A worktree prevents file corruption; it does not remove logical dependencies.

## Asynchronous Execution

Use `async: true` only when the parent has independent work to do. Retain the workflow ID, inspect status when needed, and collect it before review:

```js
subagent_wait({ id: "workflow-task-batch" })
```

If new evidence invalidates the brief, steer the live run:

```js
subagent({
  action: "steer",
  id: "workflow-task-batch",
  message: "Stop the YAML approach. The approved contract requires TOML.",
  mode: "steer"
})
```

## Clarifications and Supervisor Channel

The implementer brief must tell a blocked child not to guess. A child asks through `contact_supervisor` with `reason: "need_decision"`. The parent checks or replies through:

```js
subagent_supervisor({ action: "pending" })
subagent_supervisor({ action: "reply", replyTo: "request-id", message: "Decision and rationale" })
```

Use supervisor replies for child-initiated decisions. Use steering for parent-initiated corrections to a live asynchronous run.

## Spec Review Gate

The spec reviewer receives:

- the complete original task and acceptance criteria;
- relevant design/plan sections;
- base and head commits or exact changed-file scope;
- worker evidence and commands;
- an instruction to inspect code rather than trust the report.

The reviewer answers one question: does the implementation match the approved specification, with nothing required missing and no unapproved behavior added?

If it fails:

1. enumerate concrete gaps;
2. dispatch a worker with only those gaps;
3. verify the actual changes;
4. rerun a fresh spec review.

## Quality Review Gate

Only after spec compliance, a fresh reviewer checks:

- correctness and error handling;
- tests and meaningful failure coverage;
- maintainability and unnecessary complexity;
- security and privacy boundaries;
- performance regressions relevant to the task;
- consistency with repository conventions.

Use the requesting-code-review template referenced by [code-quality-reviewer-prompt.md](code-quality-reviewer-prompt.md). Fix important issues and rerun quality review. Do not waive findings merely to finish a batch.

## Final Review

After all tasks and local gates pass, launch a fresh reviewer over the full base-to-head diff. Give it the approved design, implementation plan, commit range, and verification commands. Resolve blocking findings before branch completion.

## Model Selection

Nicobailon's precedence is:

1. per-run model override;
2. agent frontmatter;
3. `subagents.agentOverrides`;
4. `subagents.defaultModel`;
5. parent model.

This package pins models for some custom agents and leaves `planner` configurable. Use `oracle` only for advisory challenge of risky decisions; it is not a substitute for the custom planning role.

Prefer capable models for implementation and review. Use cheap models only for bounded reconnaissance. Do not impose tight turn or tool budgets on writers that still need to test and report evidence.

## Red Flags

Never:

- dispatch without the full task text;
- run parallel writers in one workspace;
- skip actual repository inspection;
- let the implementer review its own compliance;
- combine spec and quality review into one vague pass;
- continue when a child asks a blocking question;
- omit explicit `return` from `workflowScript`;
- lose an asynchronous workflow ID;
- mark work complete before fresh final review.

## Advantages

Compared with manual inline execution, children keep task context focused and reviews independent. Compared with unattended batch execution, the parent retains decision authority and verifies each integration boundary. The cost is more orchestration, so use it only for plans whose tasks are clear enough to delegate.
