---
description: Scout gathers context, planner creates implementation plan (no implementation)
---
Execute this workflow using two sequential Agent calls:

1. Use Agent({ subagent_type: "scout", prompt: "Find all code relevant to: $@", description: "Scout: $@" }) to gather codebase context
2. Use Agent({ subagent_type: "planner", prompt: "Create an implementation plan for '$@' using this context from the scout:\n\n[paste scout result]", description: "Plan: $@" }) to create a plan

Run each agent in foreground (sequentially). Pass the scout's full result as context to the planner. Do NOT implement — just return the plan.
