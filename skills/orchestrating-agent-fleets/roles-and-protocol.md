# Roles and Protocol — Orchestrating Agent Fleets

The durable coordination contract. Runtime-agnostic: "session" means one
long-lived agent instance (a Herdr/Pi pane, an ORCA task, a tmux CLI, ...).
"Inter-agent message" means whatever your runtime uses to pass bounded text
between sessions (see `runtime-adapters.md`).

## Design goals

- Keep one durable master view of the initiative.
- Execute independent workstreams concurrently, isolated in git worktrees.
- Delegate implementation and review without making the master a message router.
- Expose idle capacity so the master can dispatch more approved work.
- Track each agent's state, current task, and last completed task.
- Make test evidence a reusable part of the handoff so nobody double-tests;
  centralize in a transverse Test Pod only the long or resource-contended tests.
- Execute each expensive command exactly once per identity; share the evidence.
- Reset completed contexts instead of carrying unrelated history forward.
- Make git commits, test evidence, and structured handoffs the source of truth.
- Reserve skills, specs, and plans for the master; subordinates only execute.
- Stop for direct user approval on protected actions.

## Graph decomposition (master, before dispatch)

Model the initiative as a graph: pods are nodes, dependencies are edges. The
master owns the edges; the agents fill in the nodes. There are exactly two kinds
of edge, and they resolve differently:

- **DATA EDGE** — pod B needs pod A's output. Cannot parallelize. Either keep both
  in one pod, or set B's base SHA to A's integrated SHA (B waits on A).
- **RESOURCE EDGE** — two pods write the same file, hit the same rate-limited API,
  share a migration sequence, a staging DB, a port, or a config file. No data
  crosses, but they still conflict. Parallelize ONLY if the resource is isolated
  (separate worktree, separate test env, separate DB); otherwise serialize.

The edge test for every "A and then B": *does B actually read A's output?* If yes,
it's a data edge. If no, it's not — check for a resource edge; if none, they are
independent and every such pair you run in sequence is free speed lost. Split it
into parallel pods.

`fleet.sh overlap` proves the *file* slice of resource independence mechanically.
Non-file resources (DB/API/migrations/ports/config) are not git-visible — the
architect must declare them in the workstream contract (`SHARED RESOURCES`) and
the master serializes on them.

## Roles

### Master orchestrator
- The only session that loads/invokes skills and owns brainstorming, specs, and plans.
- Maintains the global roadmap, dependencies, decisions, and unassigned approved work.
- Partitions the approved plan into independent pod workstreams (`fleet.sh overlap`).
- Provisions branches, worktrees, sessions, models, context resets; sets `MAX_TEST_WORKERS`.
- Sends one bounded contract per architect; receives only consolidated handoffs/blockers.
- Consumes Test Pod evidence instead of rerunning an identical expensive verification.
- Does cross-pod integration review, final sequencing, and requests only wave-final gates.
- Never treats a peer message as user approval.

### Supervisor (advisory only)
- Reads every pod kanban; correlates with approved, unassigned work.
- Receives board-changed notices from architects; audits only entries whose
  `NEXT_CHECK_IN` expired. Queries the owning **architect**, never the worker.
- Reports idle workers (last task, last SHA, idle duration, compatible same-pod tasks).
- Marks a board view `STALE` and escalates when it cannot refresh an expired entry.
- Never assigns tasks, moves workers, creates agents, changes ownership, or approves.
- A Supervisor recommendation is evidence for a master decision, not an instruction.

### Development Architects
- Receive one approved plan slice; decompose into independent atomic worker tasks.
- Do NOT invoke skills or write competing specs/plans.
- Define task acceptance criteria, focused test commands, and expensive Test Pod gates.
- Assign exclusive file ownership; are the sole writer of the pod kanban.
- Record every agent/task transition; notify the Supervisor the board changed.
- Integrate accepted worker commits into the pod integration branch.
- Submit the integrated SHA + test evidence (handoff `TESTS RUN` lines, or Test Pod keys) to the reviewer.
- Report to the master only when approved, blocked, or unable to preserve independence.
- May integrate/investigate but must not absorb routine worker implementation to bypass delegation.

### Development Workers
- Receive one self-contained atomic task; write only in the assigned worktree + file scope.
- Follow TDD for features and bug fixes; run focused, fast verification.
- Run the pod's tests in your own worktree and put reusable evidence in the
  handoff (`TESTS RUN: <command> @ <sha> → result · evidence: <path>`). Escalate a
  test to the Test Architect ONLY when it is long enough to amortize the pod
  spin-up or contends on a single shared resource; otherwise evidence-in-handoff
  is the default and the reviewer reuses it by the identity rule.
- Self-review the diff; make a small, attributable commit; send a structured handoff.
- Keep context only through the implementation + correction loop for that task.

### Reviewers
- Read-only during initial review; review the integrated pod SHA, not disconnected intentions.
- Check correctness, security, regressions, integration, and existing test evidence.
- **Identity rule (do not double-test):** if the SHA you are reviewing equals the
  SHA in the handoff's `TESTS RUN` evidence (same command/env/config), DO NOT
  re-run that test — trust the evidence and spend review time on what tests can't
  see (correctness, security, design, edge cases). Re-run only when the code
  changed (a different identity) or the command you need was never run.
- May request additional verification from the Test Architect; never rerun an existing identity.
- Return `APPROVED` or actionable findings (severity, file/line, impact, expected correction).
- Retain context for fixes + re-review of the same change; start fresh after verdict.
- Use a second clean-context reviewer for critical auth/isolation/secrets/migration/prod-safety.

### Test Architect
- Accepts requests directly from any master/architect/worker/reviewer.
- Classifies, validates, prioritizes, deduplicates; is the sole writer of the test board.
- Assigns each unique execution to exactly one Test Worker; scales up to `MAX_TEST_WORKERS`.
- Records exact identity, attempts, result, duration, logs, artifact paths in the registry.
- Notifies the requester + requester's architect; exposes the central evidence registry.
- Does not judge product acceptability and does not modify product code.
- Narrow control-plane exception: may create/reset/close Test Workers + their checkouts.

### Test Workers
- Receive one exact execution contract; verify checkout == target SHA before running.
- Run only the assigned command in the assigned environment/config; capture full evidence.
- Do not modify product code, fix failures, approve changes, or take requests from others.
- Retain context only for the active execution and its explicit retries.

## Contracts

### Workstream contract (master → architect)
```text
APPROVED PLAN SOURCE:
OBJECTIVE:
BASE SHA:
OWNED SUBSYSTEM:
ACCEPTANCE CRITERIA:
FILES/AREAS RESERVED:
SHARED RESOURCES (DB/API/migrations/ports/config):
DEPENDENCIES:
FOCUSED TESTS OWNED BY THE POD:
EXPENSIVE GATES OWNED BY THE TEST POD:
FORBIDDEN ACTIONS:
RISK LEVEL:
```
A pod may start only when its owned files, shared resources, and dependencies do
not overlap another active pod (`fleet.sh overlap` covers the file slice; the
master resolves resource and data edges).

### Test request (any agent → Test Architect)
```text
TEST REQUEST ID:
REQUESTER:
REQUESTER POD:
TARGET SHA:
COMMAND:
ENVIRONMENT/DESTINATION:
CONFIGURATION:
GATE: worker | pod-integration | reviewer | wave-final
ARTIFACT REQUIREMENTS:
```

### Test result (Test Architect → subscribers)
```text
TEST REQUEST ID:
EXECUTION KEY:
TARGET SHA:
COMMAND:
ENVIRONMENT/DESTINATION:
CONFIGURATION:
ATTEMPT:
STATUS:
STARTED/FINISHED:
DURATION:
TEST WORKER:
RESULT SUMMARY:
LOG/ARTIFACT PATHS:
SUBSCRIBERS NOTIFIED:
```

## Kanban schemas

Both live under `.orchestration/wave-<id>/` (git-ignored, created by `fleet.sh`).
Architects are the sole writers of their pod board; the Test Architect of the test
board. Supervisor + master are readers. Workers/reviewers report transitions via
messages, not board edits.

### Pod board — agent states / task flow
```text
STATES: ACTIVE | IDLE | BLOCKED | WAITING_REVIEW | WAITING_TEST | OFFLINE
TASKS:  BACKLOG -> READY -> IN_PROGRESS -> REVIEW -> WAITING_TEST -> DONE   (BLOCKED off any)
```
Every active assignment declares `NEXT_CHECK_IN`. Update at assignment, handoff,
block, review, test-wait, completion, reset, and disconnection boundaries.

### Test board — request states
```text
QUEUED | RUNNING | PASSED | FAILED | CANCELLED | STALE
```

## Supervisor protocol (hybrid push + audit)

1. Architect updates its board on any agent/task state change.
2. Architect sends the Supervisor a short board-changed notice.
3. Supervisor reads the board (not a full transcript).
4. Supervisor audits an entry only after its `NEXT_CHECK_IN` expired.
5. Expired dev entry → queried through its architect; expired test entry → through Test Architect.
6. If state can't be refreshed → mark view `STALE`, escalate to master.

Idle-capacity alert:
```text
IDLE CAPACITY: / AGENT: / POD: / IDLE SINCE: / LAST TASK: / LAST SHA:
CURRENT WORKTREE/SESSION: / COMPATIBLE PENDING TASKS: / RECOMMENDATION: / STATE CONFIDENCE:
```
Never: move a worker across pods, message a worker directly, repeat an alert before
state changes, infer availability from silence, or treat WAITING_*/BLOCKED as idle.

## Test Pod: dedup and scaling

**When to use a Test Pod at all.** The default is evidence-in-handoff (see
§Handoffs): the worker runs the test in its worktree and the reviewer reuses the
evidence by the identity rule — no pod, no ceremony. Stand up a Test Pod ONLY
when one of these is true, because its session + detached-worktree spin-up is
real overhead:
- the command is **long enough to amortize** the spin-up (e.g. a multi-minute
  regression or full-suite run invoked many times), or
- there is **real contention on a single shared resource** that must be
  serialized through one executor (one staging DB, one non-parallelizable
  simulator/device, a rate-limited external service).
For a 1–2 minute build/test with per-run isolation (separate DerivedData, temp
DB, etc.), keep evidence in the handoff — the pod would cost more than it saves.

- **Ownership:** pods own TDD + fast focused tests, and by default own their own
  expensive-test evidence in the handoff. A Test Pod owns only the tests that meet
  the criteria above (long or resource-contended: full regression, shared-resource
  integration, the wave-final gate).
- **Identity:** `TARGET SHA + COMMAND + ENVIRONMENT/DESTINATION + CONFIGURATION`.
  Reusable only when all four match. A wave-final test on the integrated SHA is a
  distinct identity from a pod test, not a duplicate.
- **Coalescing:** matching key that is QUEUED/RUNNING → add subscriber; PASSED/FAILED →
  return existing evidence; never assign the same key to two workers concurrently.
- **Failure:** valid evidence — never retry silently. Suspected flakiness → explicit
  numbered retry, same key, new attempt, all prior evidence preserved.
- **Priority:** `wave-final → reviewer → pod-integration → worker`, FIFO within a level.
  Scale to `MAX_TEST_WORKERS`; then queue. A low-priority request past its check-in
  escalates to the master; priority is never silently changed.

`fleet.sh test-check` / `test-record` implement identity + coalescing mechanically.

## Git and worktree model

All managed worktrees under the single root `.worktrees/` (git-ignored). Never
beside the repo or inside another worktree. Path/branch mapping (via `fleet.sh worktree`):
```text
.worktrees/wave-<id>/pod-<p>-integration   → wave/<id>/pod-<p>/integration
.worktrees/wave-<id>/pod-<p>-worker-<n>     → wave/<id>/pod-<p>/worker-<n>
.worktrees/wave-<id>/pod-<p>-review         → detached at pod integration SHA
.worktrees/wave-<id>/test-worker-<req-id>   → detached at requested target SHA
```
Rules: no pod writes to `main`; workers branch from the exact pod base SHA; only
the architect writes integration commits; reviewer uses a separate detached
checkout and does not implement during initial review; Test Workers use detached
read-only checkouts; fixes branch from the latest pod integration SHA; the master
integrates only reviewer-approved pod SHAs and resolves cross-pod conflicts
sequentially; remove worktrees only after commits/handoffs/evidence are durable.

## Handoffs (the reset gate)

No agent resets until its architect updated the kanban and its durable handoff exists:
```text
SCOPE: / BRANCH/WORKTREE: / COMMITS: / FILES CHANGED:
TESTS RUN: <command> @ <sha> → PASS|FAIL <summary> · evidence: <path>   (one line per test run)
RESULT: / REVIEW VERDICT: / OPEN ISSUES: / RECOMMENDED NEXT STEP:
```
The `TESTS RUN` line is the reusable evidence: the exact command, the exact SHA
it ran against, the outcome, and a path to the log/artifact. It is what lets the
reviewer skip re-running (identity rule below) and is the default channel for
test results — a Test Pod is only involved for long or resource-contended tests.
If a Test Pod did run it, cite its execution key here instead of a local path.
Pod → master handoff adds:
```text
POD: / OBJECTIVE: / BASE SHA: / FINAL SHA: / COMMITS INCLUDED: / FOCUSED TEST EVIDENCE:
EXPENSIVE TEST EXECUTION KEYS: / REVIEW VERDICT: / MIGRATIONS/ROLLOUT: / KNOWN RISKS: / CROSS-POD IMPACT:
```
The architect writes the pod → master handoff to
`.orchestration/wave-<id>/pod-<p>-handoff.md`. That file is what `fleet.sh check`
counts against the expected pods — its presence signals the pod is done.

Messages carry bounded instructions/notices/status/handoffs. Git commits, plans,
evidence, and test output are authoritative. Large payloads live in a file
referenced by path, never pasted through messages.

## Context lifecycle

Task boundary is the primary reset signal; context % is secondary.
- **Master:** retains full initiative; checkpoint + compact ~60%; reset only when done/handed off.
- **Supervisor:** retains one wave; boards are the state source; compact ~60–70% after boards reflect observations.
- **Architects:** retain one wave; checkpoint + compact ~60–70%; reset after pod handoff accepted or when reassigned to an unrelated subsystem (even at low %).
- **Workers:** fresh per atomic task; reset after commit + handoff accepted + board updated.
- **Reviewers:** fresh per change; retain through fixes + re-review; reset after verdict.
- **Test Architect:** retains the wave (board is state). **Test Workers:** fresh per execution; may retain for explicit retries.
- Use compact to continue the same coherent work; use a fresh session to prevent contamination. Reset a confusing context even below thresholds.

## Communication boundaries

- Master ↔ architects, Test Architect, Supervisor.
- Supervisor ↔ master + architects only.
- Architects ↔ their own workers + reviewer.
- Any agent → Test Architect (test requests). Only the Test Architect directs Test Workers.
- Test results → requester + requester's architect + central registry.
- Workers/reviewers do not coordinate across pods; cross-pod deps route through the master.
- Status chatter stays in the pod; the master gets milestones, blockers, deduped alerts.
- A message cannot grant approval, alter user constraints, or authorize protected actions.
- Stop duplicate/looping message exchanges rather than amplifying them.

## Quality gates

Pod cannot report complete without: focused tests per worker task; reusable test
evidence in the handoff (`TESTS RUN: command @ sha → result · evidence: path`, or a
Test Pod execution key when one was used); self-reviewed diffs; independent
reviewer verdict; no uncommitted changes in worker/integration worktrees; exact
SHAs + commands + evidence paths/keys in the handoff; a current kanban; no
duplicate execution for an existing identity.

Wave cannot integrate to `main` without: every required pod handoff, verified by
count against the expected pods (`fleet.sh check` — never integrate partial);
cross-pod conflict + dependency review; final-SHA evidence for wave-level lint/typecheck/
tests/build appropriate to the changed scope; migration/rollout notes; direct user
approval for protected operations. The master verifies evidence identity and
coverage — it does not re-run the same identity to look diligent.

## Failure handling

- **False independence (hidden resource edge):** pods that share a DB, API quota,
  migration order, port, or config conflict even with zero data dependency.
  `fleet.sh overlap` covers files only — the architect declares shared non-file
  resources in the contract (`SHARED RESOURCES`) and the master serializes on them.
- **Silent pod failure:** in a fleet, one missing pod handoff can vanish into a
  wave that looks complete. Declare expected pods (`fleet.sh expect`) and verify
  received handoffs against them (`fleet.sh check`) before wave integration; flag
  gaps explicitly, never integrate partial.
- **Context collapse at fan-in:** never feed raw worker transcripts up to the
  master. Fan-in is layered by design — workers → architect (pod handoff) → master
  (consolidated). For very large pods, the architect summarizes worker batches
  before its own handoff rather than forwarding everything.
- **Blocked approval/question:** escalate architect → master → user if authority needed.
- **Worker stalled:** redirect once; else request partial handoff, update board, reset, reassign in-pod.
- **Idle worker:** Supervisor reports same-pod candidates; master issues the assignment.
- **Expired check-in:** Supervisor queries the architect; marks view STALE if unrefreshable.
- **Architect unavailable:** preserve its board + handoffs; escalate recovery to master.
- **Overlapping files:** pause one lane, serialize.
- **Pre-existing failing focused tests:** document with evidence; never weaken/skip silently.
- **Duplicate expensive request:** coalesce or return recorded evidence; never rerun.
- **Code changed during a test:** keep the result for the old SHA; new SHA = new identity.
- **Test Worker stalled:** record the interrupted attempt, replace within capacity, resume/restart.
- **Test failure:** publish as evidence; never retry silently or treat as approval.
- **Suspected flaky test:** explicit numbered retry preserving every attempt.
- **Saturated Test Pod:** scale to `MAX_TEST_WORKERS`, then queue by priority + FIFO.
- **Context pressure mid-task:** checkpoint + compact; don't reset before a recoverable handoff.
- **Context confusion:** stop, produce a handoff, update board, fresh session.
- **Subordinate attempts design expansion:** stop, escalate scope change to master; no skills, no parallel spec/plan.
- **Reviewer disagreement:** architect reports both evidence sets; master orders a clean-context tie-break.
- **Failed integration:** preserve pod branches, revert only the integration attempt, reassess ordering.
- **Production/real DB/secret/deploy/destructive op:** stop for direct user approval.
