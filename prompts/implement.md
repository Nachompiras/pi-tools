---
description: Full implementation workflow - scout gathers context, planner creates plan, worker implements
---
Execute this workflow using three sequential Agent calls:

1. Use Agent({ subagent_type: "scout", prompt: "Find all code relevant to: $@", description: "Scout: $@" }) to gather codebase context
2. Use Agent({ subagent_type: "planner", prompt: "Create an implementation plan for '$@' using this context from the scout:\n\n[paste scout result]", description: "Plan: $@" }) to create a plan
3. Use Agent({ subagent_type: "worker", prompt: "Implement this plan:\n\n[paste planner result]", description: "Implement: $@" }) to execute the plan

Run each agent in foreground (sequentially). Pass the full result of each step as context to the next.
