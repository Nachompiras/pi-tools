---
description: Worker implements, reviewer reviews, worker applies feedback
---
Execute this workflow using three sequential Agent calls:

1. Use Agent({ subagent_type: "worker", prompt: "Implement: $@", description: "Implement: $@" }) to implement the task
2. Use Agent({ subagent_type: "reviewer", prompt: "Review this implementation:\n\n[paste worker result]", description: "Review implementation" }) to review the work
3. Use Agent({ subagent_type: "worker", prompt: "Apply this review feedback:\n\n[paste reviewer result]", description: "Apply review feedback" }) to apply the feedback

Run each agent in foreground (sequentially). Pass the full result of each step as context to the next.
