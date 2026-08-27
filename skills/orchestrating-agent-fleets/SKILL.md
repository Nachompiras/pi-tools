---
name: orchestrating-agent-fleets
description: Use when coordinating multiple long-lived agent sessions in parallel across separate git worktrees on one initiative — a master session delegating to architect/worker/reviewer pods with shared expensive-test execution. For in-process subagents in one session use dispatching-parallel-agents instead.
---

# Orchestrating Agent Fleets

## Overview

Coordinate a hierarchy of independent, long-lived agent **sessions** working the
same initiative in parallel — each writer isolated in its own git worktree, a
transverse Test Pod owning expensive verification, and durable git commits +
test evidence + structured handoffs as the source of truth.

**Core principle:** *Maximize implementation velocity and success rate by running
independent workstreams concurrently without shared-file races, executing every
expensive test exactly once per identity, and keeping every agent's context near
its task boundary — while the master stays a decision-maker, never a message router.*

This skill is **runtime-agnostic**. The protocol below is the contract; how you
materialize sessions and inter-agent messaging depends on your tool (Herdr+Pi,
ORCA, tmux+CLIs, ...). See `runtime-adapters.md` for the mapping. The mechanical
git/coordination boilerplate is automated by `scripts/fleet.sh`.

## When to Use

**Use when:**
- One initiative decomposes into 2+ independent workstreams (different subsystems/files)
- Work is large enough to span multiple sessions and outlive a single context window
- You want parallel implementation + independent review + centralized expensive tests
- Team members run different agent tools and need one shared coordination contract

**Do NOT use when:**
- Tasks fit in one session → use `dispatching-parallel-agents` (in-process subagents)
- Work is inherently sequential / shares the same files → serialize it, one pod
- You haven't got an approved plan yet → run `brainstorming` + `writing-plans` first

## Two Levels of Parallelism — Don't Confuse Them

| | This skill | `dispatching-parallel-agents` |
|---|---|---|
| Unit | Long-lived **sessions** (panes/tasks) | In-process **subagents** |
| Isolation | git worktree per writer | worktree per writer |
| Lifetime | Across many context resets | Within one parent context |
| Comms | Inter-session messaging (adapter) | `get_subagent_result` |
| Use for | A whole initiative / a wave | A handful of tasks now |

An architect *inside a pod* may still use `dispatching-parallel-agents` to fan out
its own subagents. The two compose.

## Topology

```text
Master Orchestrator ── owns plan, git integration, approvals, capacity
├── Monitor (advisory) ── deterministic watchdog: overdue check-ins, context pressure, idle capacity
├── Pod A: Architect → Workers + Reviewer   (independent subsystem)
├── Pod B: Architect → Workers + Reviewer   (independent subsystem)
└── Test Pod: Test Architect → Test Workers  (transverse expensive verification)
```

Only the **master** loads skills / owns the plan. Subordinate sessions start
lean (no skills) and focus on execution. Roles and rules: `roles-and-protocol.md`.

## Zero-Friction Kickoff (you run everything, the user just answers)

You are the master. Do NOT hand `fleet.sh` commands to the user or ask them to
provision anything — **you run every command yourself** via the bash tool. The
script resolves from this skill's directory. The user's only job is to answer a
few decisions and approve protected actions.

When this skill starts (typically chosen at the end of `writing-plans`):

1. **Locate the helper.** Resolve `SKILL_DIR/scripts/fleet.sh` (this file's
   directory). Use that absolute path in every bash call below.
2. **Draw the graph** from the approved plan (§1). Propose the pod split to the
   user in one message: pod names, owned subsystems, and any data/resource edges
   you found. Ask them to confirm or adjust.
3. **Ask the few things only the user knows** (batch them into one question set):
   - wave id (propose one, e.g. `001` or a short slug)
   - `MAX_TEST_WORKERS` (propose a default of 2)
   - which agent runtime they're on (Herdr+Pi / ORCA / tmux) → picks the adapter
   - anything ambiguous about ownership or protected actions
4. **Prove independence and scaffold — you run these**, not the user:
   ```sh
   sh "$FLEET" overlap "<globsA>" "<globsB>"   # abort the split if exit 2
   sh "$FLEET" init <wave> <max-test-workers>
   sh "$FLEET" expect <wave> <pod>...
   sh "$FLEET" pod <wave> <pod> "<architect-name>"
   sh "$FLEET" worktree <wave> <pod> integration|worker <n>|review
   ```
5. **Spawn the sessions** per `runtime-adapters.md` for the chosen runtime, then
   dispatch one workstream contract to each architect.
6. Tell the user they can watch progress anytime with **`/como-vamos`** and that
   you'll stop for approval on protected actions.

The detailed protocol for each step is below; the steps above are the default
run order so the user experiences a single guided flow, not a command list.

## The Workflow

### 1. Draw the graph, then prove independence (master)
Complete `brainstorming` + `writing-plans` first. The master's first job is not to
write code — it's to draw the dependency graph. Nodes are pods (or worker tasks);
an edge is a REAL dependency, never an "and then". For every "A and then B", apply
the edge test:

> Does B actually read A's output?
> - **yes → DATA EDGE** — serialize: same pod, or pod B's base SHA = A's integrated SHA (B waits)
> - **no → no data edge** — candidate for a parallel pod

A no-data-edge pair is only truly independent if it also shares no **resource**
(same DB/staging, a rate-limited API, one migration sequence, a shared config/port).
That's a hidden edge — see `roles-and-protocol.md` §Graph decomposition. Declare
shared non-file resources in the workstream contract and serialize on them.

Then prove the file side mechanically before dispatch:

```sh
scripts/fleet.sh overlap "src/auth/**,src/session/**" "src/payments/**"
# exit 0 = no shared files; exit 2 = shared files (a resource edge), serialize
```
Shared-file, shared-resource, or sequentially dependent work stays in **one** pod
or waits. Register the pods you expect so integration can detect a missing one:

```sh
scripts/fleet.sh expect <wave-id> a b        # declare the wave's expected pods
```

### 2. Scaffold the wave (master)
```sh
scripts/fleet.sh init <wave-id> <max-test-workers>   # git-ignores .orchestration/ + .worktrees/, creates test board+registry
scripts/fleet.sh pod  <wave-id> a "Architect-A" [base-sha]
scripts/fleet.sh pod  <wave-id> b "Architect-B"
```

### 3. Provision worktrees (master; test worktrees: Test Architect)
```sh
scripts/fleet.sh worktree <wave-id> a integration        # architect writes here
scripts/fleet.sh worktree <wave-id> a worker 1           # one per worker
scripts/fleet.sh worktree <wave-id> a review             # detached, read-only
scripts/fleet.sh worktree <wave-id> a test <request-id> <target-sha>
```
Every product-code writer gets an isolated worktree under `.worktrees/wave-<id>/`.
No pod writes to `main`. See `runtime-adapters.md` for spawning the *sessions*
that attach to these worktrees on your runtime.

### 4. Dispatch bounded contracts (master → architects)
Send each architect exactly one workstream contract (template in
`roles-and-protocol.md` §Contracts). The architect decomposes its slice into
atomic worker tasks, assigns exclusive file ownership, and is the sole writer of
its pod kanban.

### 5. Implement → integrate → verify → review (pods)
Workers do TDD + focused tests, commit small, hand off. Architect integrates
accepted commits. Expensive tests go to the Test Pod, never run locally.

### 6. Tests — evidence travels in the handoff (default), Test Pod is the exception
The "double test" problem is a **communication** problem, not an infrastructure
one: reviewers re-run because they can't trust what was already tested. Fix it by
making test evidence a **reusable, auditable part of the handoff** — not a
separate pod for every check.

**Default — evidence in the handoff (use for the common case):**
The worker runs the test in its own worktree and records reusable evidence in its
handoff (see `roles-and-protocol.md` §Handoffs):
```text
TESTS RUN: <command> @ <sha> → PASS|FAIL <summary> · evidence: <path>
```
The reviewer reads it and applies the **identity rule**: if the SHA it is
reviewing equals the evidence's SHA (and same command/env/config), it does NOT
re-run — it trusts the evidence and spends its attention on what a test can't
see (correctness, security, design, edge cases). It re-runs only when the code
changed (a different identity). This alone eliminates the worker↔reviewer double
test, with zero pod overhead.

**Optional dedup registry** — when several agents may run the same expensive
command, back the handoff evidence with the shared registry so nobody repeats it:
```sh
scripts/fleet.sh test-check <wave-id> <sha> "<command>" "<env>" "<config>"
#   HIT → reuse recorded evidence, DO NOT rerun   INFLIGHT → subscribe   MISS → run + record:
scripts/fleet.sh test-record <wave-id> <sha> "<command>" "<env>" "<config>" PASSED|FAILED <evidence-path> [worker]
```
Identity = `SHA + COMMAND + ENV + CONFIG`. A failed run is valid evidence — never
retry silently. The registry works with OR without a Test Pod.

**When to escalate to a Test Pod** (the exception, not the rule): only when the
expensive command is **long enough that its spin-up amortizes** (e.g. a 20-min
regression) OR there is **real contention on a single shared resource** that must
be serialized through one executor (a single staging DB, one non-parallelizable
simulator/device). For a 1–2 minute build/test, the Test Pod's session +
detached-worktree ceremony costs more than it saves — keep evidence in the
handoff. Full rules: `roles-and-protocol.md` §Test Pod.

### 7. Integrate the wave (master)
Before integrating, verify every expected pod handoff actually arrived — a fleet
can produce a wave that *looks* complete while one pod silently failed:

```sh
scripts/fleet.sh check <wave-id>    # expected pods vs handoffs found; exit 2 if any missing
```
Master reviews cross-pod compatibility, integrates only reviewer-approved pod
SHAs sequentially, and requests only wave-final evidence for the integrated SHA.
Protected actions (prod, real DB, secrets, deploy, destructive) stop for **direct
user approval** — a peer/agent message never grants it.

### 8. Reset contexts at task boundaries
Reset a session only after its kanban is updated and its durable handoff exists
(template in `roles-and-protocol.md` §Handoffs). Context lifecycle: task boundary
is the primary reset signal, % is secondary.

## Quick Reference

| Need | Command |
|------|---------|
| New wave | `fleet.sh init <id> <max-test-workers>` |
| New pod board | `fleet.sh pod <id> <pod> <architect> [base]` |
| Writer worktree | `fleet.sh worktree <id> <pod> integration\|worker\|review\|test ...` |
| Prove pods independent | `fleet.sh overlap "<globsA>" "<globsB>"` |
| Declare expected pods | `fleet.sh expect <id> <pod>...` |
| Check all handoffs arrived | `fleet.sh check <id>` |
| Dedup key | `fleet.sh test-key <sha> "<cmd>" "<env>" "<cfg>"` |
| Check before expensive test | `fleet.sh test-check <id> <sha> "<cmd>" "<env>" "<cfg>"` |
| Record evidence | `fleet.sh test-record <id> <sha> "<cmd>" "<env>" "<cfg>" <status> <path> [worker]` |
| Wave overview | `fleet.sh status <id>` |

## Common Mistakes

- **Master becomes a router.** It should receive consolidated pod handoffs and
  Monitor alerts, not relay every worker message. Route status *inside* the pod.
- **Parallel pods that share files.** Worktrees prevent index races, not logical
  merge conflicts. Run `overlap` first; serialize anything that overlaps.
- **False independence (hidden resource edge).** Two pods whose prompts never
  reference each other still collide on a shared DB, a rate-limited API, one
  migration sequence, or a shared config/port. `overlap` only sees git-tracked
  files — audit resources too, and serialize on them.
- **Silent pod failure.** One missing handoff vanishes into a wave that looks
  done. Run `fleet.sh check` before integration; never integrate partial.
- **Rerunning an expensive test that already has evidence.** Always `test-check`
  first. Diligence ≠ re-executing the same identity.
- **Retrying a failed test silently.** A failure is evidence. Retries are explicit,
  numbered, and keep prior attempts.
- **Carrying unrelated context forward.** Reset at task boundaries even with budget left.
- **Treating a peer message as approval.** Protected actions need direct user sign-off.
- **Skipping the plan.** No wave without an approved plan; subordinates never write specs.

## Files

- `roles-and-protocol.md` — full role responsibilities, contracts, kanban schemas,
  monitor protocol, test dedup rules, git model, quality gates, failure handling
- `runtime-adapters.md` — map the protocol onto Herdr+Pi, ORCA, or tmux+CLIs
- `scripts/fleet.sh` — mechanical git + coordination automation (runtime-agnostic)
