---
name: dispatching-parallel-agents
description: Use when facing 2+ independent tasks that can be worked on without shared state or sequential dependencies
---

# Dispatching Parallel Agents

Delegate independent tasks to specialized subagents running concurrently, using the `@tintinweb/pi-subagents` extension and its `Agent()`, `get_subagent_result()`, and `steer_subagent()` tools.

**Why parallel:** Independent tasks don't need to be sequential. Run them simultaneously, get results faster, keep each agent focused on a narrow scope.

**Core principle:** Launch background agents with `Agent({ run_in_background: true })`, then collect results with `get_subagent_result()`. A persistent widget shows spinners, status icons, and live progress for all running agents.

## When to Use

**Use when:**
- 2+ tasks are clearly independent (different files, different subsystems)
- No task needs output from another to start
- No shared state between agents (no same-file edits)
- You want live progress from all agents simultaneously

**Don't use when:**
- Tasks share files (causes conflicts — use `isolation: "worktree"` if needed)
- Task B depends on Task A's output (use sequential foreground calls instead)
- You need to understand full system state first
- You're still debugging (explore root cause first, then parallelize fixes)

## The Pattern

### 1. Assess Independence

Group tasks by file scope:
- Task A: `src/auth/` only -> independent
- Task B: `src/payments/` only -> independent
- Task C: `src/config.ts` (shared) -> sequential dependency

### 2. Dispatch Background Agents, Then Collect Results

Launch all independent tasks as background agents, then wait for each result:

```
# Launch all agents in the background
Agent({ subagent_type: "worker", prompt: "Fix 3 failing tests in src/auth.test.ts: [paste test names + errors]", description: "fix auth tests", run_in_background: true })
Agent({ subagent_type: "worker", prompt: "Fix 3 failing tests in src/payments.test.ts: [paste test names + errors]", description: "fix payment tests", run_in_background: true })
Agent({ subagent_type: "worker", prompt: "Fix 3 failing tests in src/notifications.test.ts: [paste test names + errors]", description: "fix notification tests", run_in_background: true })

# Collect results (use agent_id returned by each Agent() call)
get_subagent_result({ agent_id: "<id-from-agent-1>", wait: true })
get_subagent_result({ agent_id: "<id-from-agent-2>", wait: true })
get_subagent_result({ agent_id: "<id-from-agent-3>", wait: true })
```

The persistent widget shows spinners and status icons for all running agents. Results are collected as each agent finishes.

### 3. Sequential Pipelines (Foreground Agents)

When tasks need to pass output forward, run agents sequentially in the foreground. Each call blocks and returns a result you feed into the next prompt:

```
# Step 1: Scout gathers context (foreground, blocks until done)
result_1 = Agent({ subagent_type: "scout", prompt: "Find all authentication code and summarize", description: "auth recon" })

# Step 2: Planner uses scout's output
result_2 = Agent({ subagent_type: "planner", prompt: "Based on this recon: <result_1 text> — create an implementation plan", description: "auth plan" })

# Step 3: Worker executes the plan
Agent({ subagent_type: "worker", prompt: "Execute this plan: <result_2 text>", description: "auth implementation" })
```

Each foreground `Agent()` call returns its result directly. Pass the result text as context into the next prompt.

### 4. Single Agent for One Task

```
Agent({ subagent_type: "worker", prompt: "Fix the race condition in src/queue.ts", description: "fix queue race condition" })
```

### 5. Mid-Run Steering

If a running agent goes off-track, redirect it without aborting:

```
steer_subagent({ agent_id: "<id>", message: "Stop refactoring — focus only on the failing test. The error is in line 42." })
```

### 6. Worktree Isolation

When parallel tasks might touch overlapping files, use worktree isolation:

```
Agent({ subagent_type: "worker", prompt: "Refactor auth module", description: "auth refactor", isolation: "worktree", run_in_background: true })
```

## Writing Focused Agent Tasks

Good parallel tasks are:

1. **Scoped** — one file or subsystem, not "fix everything"
2. **Self-contained** — all context needed to understand the problem
3. **Specific about output** — what should the agent return?

```markdown
Fix the 3 failing tests in src/agents/agent-tool-abort.test.ts:

1. "should abort tool with partial output" - expects 'interrupted at' in message
2. "should handle mixed completed and aborted tools" - fast tool aborted instead of completed
3. "should properly track pendingToolCount" - expects 3 results but gets 0

These are timing/race condition issues. Your task:
1. Read the test file and understand what each test verifies
2. Identify root cause — timing or actual bugs?
3. Fix by replacing arbitrary timeouts with event-based waiting
4. Do NOT just increase timeouts

Return: Summary of root cause and what you fixed.
```

## Available Agents

### Built-in Types

These are always available, no setup needed:

| Type | Purpose | Tools |
|------|---------|-------|
| `general-purpose` | Full-capability agent, mirrors parent's tool access | all parent tools |
| `Explore` | Lightweight read-only exploration (haiku model) | read, grep, find, ls |
| `Plan` | Read-only planning and analysis | read, grep, find, ls |

### Custom Agent Types

These require `.md` definition files installed by the user (in `.pi/agents/` or user-level agents directory). They are **not** available unless set up:

| Type | Purpose | Tools |
|------|---------|-------|
| `worker` | General-purpose implementation | all default |
| `scout` | Fast codebase recon, returns compressed context | read, grep, find, ls, bash |
| `planner` | Creates implementation plans | read, grep, find, ls |
| `reviewer` | Code review (read-only) | read, grep, find, ls, bash |

If you use a custom type that isn't installed, the agent will fail. Fall back to `general-purpose` if unsure.

## Output and Monitoring

The `@tintinweb/pi-subagents` extension provides a persistent widget showing all agent activity:

- **Spinner** for running agents with current tool call info
- **Status icons** (checkmark/cross) for completed/failed agents
- Live updates as agents make progress

Use `get_subagent_result({ agent_id: "<id>", wait: true })` to block until a specific agent finishes and retrieve its full output.

## Concurrency

- Default: 4 agents run concurrently
- Configurable via `/agents` -> Settings in the pi TUI
- Split larger batches if you exceed the limit: launch first batch, collect results, then launch next batch

## Common Mistakes

**X Parallel tasks that edit the same file** -> merge conflicts, corrupted output
**OK Verify file scope is disjoint before dispatching, or use `isolation: "worktree"`**

**X Too broad:** "Fix all the tests" -> agent gets lost
**OK Specific:** "Fix auth.test.ts" -> focused scope

**X No context:** "Fix the race condition" -> agent doesn't know where
**OK Context:** Paste the error messages and test names

**X No constraints:** Agent might refactor everything
**OK Constraints:** "Do NOT change production code" or "Fix tests only"

**X Vague output:** "Fix it" -> you don't know what changed
**OK Specific:** "Return summary of root cause and changes"

**X Forgetting to collect results:** Launching background agents but never calling `get_subagent_result()`
**OK Always collect:** Call `get_subagent_result({ agent_id: "...", wait: true })` for each background agent

**X Using custom agent types without setup:** `worker`, `scout`, etc. need `.md` files installed
**OK Fall back to `general-purpose`** if custom agents aren't configured
