---
description: Implement, independently review, and apply review feedback
---

Create one foreground `subagent({ workflowScript, async: false })` workflow for this request:

$@

Inside the script:

1. Await `runs.run("implement", ...)` with agent `worker`. Include the full request and require tests plus exact changed-file evidence.
2. Await `runs.run("review", ...)` with a fresh `reviewer`. Include the original request, repository scope, and worker output; require inspection of the actual diff.
3. If the review reports Critical or Important issues, await `runs.run("fix", ...)` with agent `worker`. Include the original request and exact review findings, then require rerun verification. Otherwise retain the original implementation result.
4. Explicitly return implementation, review, and optional fix outputs.

Inspect the final diff yourself. Do not claim approval merely because the workflow completed.
