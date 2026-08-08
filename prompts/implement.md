---
description: Scout, plan, and implement a task through pi-subagents
---

Create one foreground `subagent({ workflowScript, async: false })` workflow for this request:

$@

Inside the script:

1. Await `runs.run("scout", ...)` with agent `scout` to identify relevant files, behavior, tests, and risks.
2. Await `runs.run("plan", ...)` with the custom `planner`; include the full request and `scan.output`.
3. Await `runs.run("implement", ...)` with agent `worker`; include the full request, approved constraints, and `plan.output`. Require tests, verification, changed files, and residual risks.
4. Explicitly return all three stage outputs so the parent can verify the implementation rather than trusting only the final summary.

After the workflow returns, inspect the actual repository diff and verification evidence before reporting completion.
