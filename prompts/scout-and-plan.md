---
description: Scout the codebase, then create an implementation plan
---

Create one foreground `subagent({ workflowScript, async: false })` workflow for this request:

$@

Inside the script:

1. Call `runs.run("scout", ...)` with agent `scout` and a self-contained task to find relevant files, entry points, data flow, tests, and risks.
2. Await the result and call `runs.run("plan", ...)` with the custom `planner` agent. Include the full request and `scan.output` in its task.
3. Explicitly return the planner output together with the scout evidence.

Do not implement. Present the returned plan and important reconnaissance evidence to the user.
