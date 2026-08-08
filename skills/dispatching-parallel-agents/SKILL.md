---
name: dispatching-parallel-agents
description: Use when facing 2+ independent tasks that can be worked on without shared state or sequential dependencies
---

# Dispatching Parallel Agents

Delegate focused work through Nicobailon's `pi-subagents` extension.

**Core principle:** Put independent children in one `runs.all(...)` workflow. Use `runs.run(...)` for one child or sequential stages. Every `workflowScript` is a JavaScript statement body and must explicitly `return` useful output.

## When to Use

Use parallel children when:

- two or more tasks are independent;
- each task has a clear file or research scope;
- no task needs another task's result before starting;
- concurrent writers use separate managed worktrees.

Do not use parallel children when:

- tasks edit the same files without worktree isolation;
- a later task depends on an earlier result;
- the root cause is still unknown;
- one well-scoped child is sufficient.

## Parallel Workflow

Launch one coordinated foreground workflow when the parent needs every result immediately:

```js
subagent({
  workflowScript: `
    const results = await runs.all([
      {
        key: "auth-tests",
        agent: "worker",
        task: "Fix the listed auth tests. Do not widen scope. Return changed files and commands run."
      },
      {
        key: "payment-tests",
        agent: "worker",
        task: "Fix the listed payment tests. Do not widen scope. Return changed files and commands run."
      }
    ]);
    return results.map(result => ({ key: result.key, output: result.output }));
  `,
  async: false
})
```

Use stable, descriptive keys. A single `runs.all(...)` lets the runtime coordinate concurrency, failures, status, and output.

## Sequential Workflow

When later work depends on earlier output, keep the stages in one script:

```js
subagent({
  workflowScript: `
    const scan = await runs.run("auth-scan", {
      agent: "scout",
      task: "Find the authentication entry points, data flow, tests, and risks."
    });
    const plan = await runs.run("auth-plan", {
      agent: "planner",
      task: "Create an implementation plan from this scout report:\n\n" + scan.output
    });
    return runs.run("auth-implementation", {
      agent: "worker",
      task: "Implement and verify this approved plan:\n\n" + plan.output
    });
  `,
  async: false
})
```

Pass prior `.output` explicitly. Do not assume a fresh child can see another child's transcript.

## One Child

```js
subagent({
  workflowScript: `
    return runs.run("queue-fix", {
      agent: "worker",
      task: "Fix the queue race condition, add a regression test, and report verification."
    });
  `,
  async: false
})
```

## Asynchronous Work

Use asynchronous execution only when useful work can continue in the parent:

```js
subagent({
  workflowScript: `
    return runs.run("long-audit", {
      agent: "reviewer",
      task: "Audit the requested module and return findings with file and line evidence."
    });
  `,
  async: true
})
```

Retain the returned workflow `id`. Collect it before claiming completion:

```js
subagent_wait({ id: "<workflow-id>" })
```

Inspect without blocking:

```js
subagent({ action: "status", id: "<workflow-id>" })
```

Steer a live asynchronous run when new information changes its task:

```js
subagent({
  action: "steer",
  id: "<workflow-id>",
  message: "Use TOML rather than YAML; the contract is in src/config.toml.",
  mode: "steer"
})
```

`mode: "follow_up"` queues guidance for the next turn boundary. `mode: "auto"` chooses immediate or queued delivery based on child state.

## Worktree Isolation

Parallel writers need isolated worktrees:

```js
subagent({
  workflowScript: `
    const results = await runs.all([
      { key: "api", agent: "worker", task: "Implement the API slice.", worktree: true },
      { key: "ui", agent: "worker", task: "Implement the UI slice.", worktree: true }
    ]);
    return results.map(result => ({ key: result.key, artifacts: result.artifactPaths }));
  `,
  async: false
})
```

Return the handoff artifacts so the parent can inspect and apply each patch. Read-only children normally do not need worktrees. Prefer one writer when changes cannot be cleanly separated.

## Writing Focused Tasks

A good child task is:

1. **Scoped** — names one subsystem, file set, or question.
2. **Self-contained** — includes requirements and known evidence.
3. **Constrained** — states what must not change.
4. **Verifiable** — names tests or evidence expected.
5. **Output-specific** — requests changed files, commands, findings, or risks.

Do not write “fix everything” or “review this.” Include failing test names, errors, file boundaries, and acceptance criteria.

## Available Agents

### Builtins from `pi-subagents`

| Agent | Purpose |
|-------|---------|
| `scout` | Fast local codebase reconnaissance |
| `researcher` | Web and documentation research; requires `pi-web-access` |
| `worker` | Implementation and validation |
| `reviewer` | Independent review and small fixes |
| `oracle` | Advisory second opinion for risky decisions |
| `delegate` | General delegation close to parent behavior |

### Agents provided by this package

| Agent | Purpose |
|-------|---------|
| `explore` | Read-only codebase exploration |
| `planner` | Read-only implementation planning |
| `scout` | Compressed local reconnaissance |
| `worker` | Implementation with full tools |
| `reviewer` | Read-only quality and security review |

Package, user, and project definitions can override builtins with the same name. Use `subagent({ action: "list" })` to inspect the effective catalogue.

## Child Questions

For work that may need a decision, tell the child to use `contact_supervisor`. Reply from the parent with `subagent_supervisor({ action: "reply", replyTo, message })`. Use parent-initiated steering for corrections, not as a substitute for clear initial requirements.

## Common Mistakes

- **Multiple model-level launches for one batch:** use one `runs.all(...)` workflow.
- **Missing `return`:** the script completes without a useful aggregate result.
- **Parallel edits in one workspace:** use per-child `worktree: true` or serialize.
- **Lost async ID:** retain it and call `subagent_wait`.
- **Passing only a child summary to reviewers:** include the original requirements and repository scope.
- **Assuming child context is shared:** pass prior output or required files explicitly.
- **Hard limits on writers:** bound the task and runtime rather than preventing necessary verification.
