# Runtime Adapters — Orchestrating Agent Fleets

The protocol in `roles-and-protocol.md` is runtime-agnostic. It needs four
primitives from whatever tool you run agents on. This file maps those primitives
onto the tools the team uses. `scripts/fleet.sh` already owns everything that is
pure git + local files (worktrees, branches, kanbans, test dedup) — identical on
every runtime. Adapters only cover what `fleet.sh` cannot: spawning sessions and
passing messages between them.

## The four primitives every runtime must provide

| # | Primitive | What the protocol needs |
|---|-----------|-------------------------|
| 1 | **Spawn session** | Start a long-lived agent bound to a specific worktree, model, and role, started lean (no skills for subordinates) |
| 2 | **Message session** | Pass bounded text (contracts, notices, handoffs) between named sessions |
| 3 | **Reset session** | Clear a completed context; start fresh at a task boundary |
| 4 | **Address book** | Stable handles to reach sessions; refreshable after topology changes |

`fleet.sh` provides the worktrees these sessions attach to. The adapter provides
1–4. If a runtime lacks a primitive, use the fallback (files-as-mailbox) below.

---

## Adapter A — Herdr + Pi (native)

The original design target. Direct 1:1 mapping.

| Primitive | Herdr + Pi |
|-----------|------------|
| Spawn | Master creates a Herdr pane; start the Pi session with `--no-skills` for every subordinate (only the master loads skills). Point its cwd at the `fleet.sh`-created worktree. |
| Message | `message_peer` / `list_peers` (pi-peer). Bounded text only; large payloads go in a file referenced by path. |
| Reset | `/new` for a clean context (keeps `--no-skills`), `/compact` to continue the same coherent work. |
| Address book | Herdr agent names are stable control handles. Pi-peer addresses may gain a suffix after `/new` — the controller re-runs `list_peers` before dispatching new work. |

Notes:
- Subordinates still load project context (`AGENTS.md`) and keep their tools/extensions.
- The Test Architect is the only subordinate allowed a narrow control-plane action:
  create/reset/close its own Test Worker sessions up to `MAX_TEST_WORKERS`.
- Master model tiers (from the source design, adjust to budget): architects/reviewers
  on a strong reasoning model at high/xhigh; workers on a cheaper fast model at high.

---

## Adapter B — ORCA (onorca.dev)

ORCA is an Agent Development Environment that runs Claude Code / Codex / OpenCode /
etc. side by side, each in an **isolated worktree**, with built-in git tracking,
tasks, and automations. It maps cleanly, with two caveats.

| Primitive | ORCA |
|-----------|------|
| Spawn | Create one **task** per agent (architect/worker/reviewer/test). Each task runs your chosen CLI agent in its own worktree. **Let `fleet.sh` create the branch/worktree first**, then point the ORCA task at that path/branch so the naming stays consistent across the team — or use ORCA's worktree and record its path in the kanban. Pick one convention per wave; don't mix. |
| Message | ORCA has no pi-peer. Use the **files-as-mailbox** fallback (below): each session polls `.orchestration/wave-<id>/inbox/<role>.md`. Contracts, notices, and handoffs are appended there. This is the portable substitute for `message_peer`. |
| Reset | Start a fresh task (or clear the agent's conversation) at the task boundary — the equivalent of `/new`. There is no `/compact`; when context is tight, write a checkpoint to the handoff file and start fresh. |
| Address book | ORCA task names are the stable handles. Keep a `roster.md` in the wave dir mapping role → task name/worktree so any session can find another's inbox. |

Caveats:
1. **Mixed CLI agents.** Because pods may run different underlying agents (Claude
   Code vs Codex vs ...), the *only* reliable shared contract is the files: git
   commits, the kanbans, the test registry, and the inbox files. Do not rely on any
   one agent's native memory. This is exactly what the protocol already mandates.
2. **No native inter-agent messaging.** The files-as-mailbox fallback is required.
   ORCA automations can be used to notify/trigger on file changes, but the message
   *content* lives in the inbox files so every agent type can read it.

---

## Adapter C — tmux + CLI agents (bare fallback)

Any setup where you run agent CLIs in terminal panes.

| Primitive | tmux + CLIs |
|-----------|-------------|
| Spawn | `tmux new-window`/`split-window`, `cd` into the `fleet.sh` worktree, launch the CLI with its no-skills/lean flag if it has one. |
| Message | Files-as-mailbox (below). `tmux send-keys` can nudge a pane to re-read its inbox. |
| Reset | Restart the CLI in the pane (fresh context) at the task boundary. |
| Address book | `roster.md` mapping role → tmux target (`session:window.pane`). |

---

## Files-as-mailbox fallback (works everywhere)

When a runtime has no native inter-session messaging, use the coordination dir
`fleet.sh` already created. This is the universal substitute for `message_peer`.

Layout (all git-ignored under `.orchestration/wave-<id>/`):
```text
.orchestration/wave-<id>/
├── roster.md              role → session handle + worktree
├── inbox/
│   ├── master.md
│   ├── architect-a.md
│   ├── architect-b.md
│   ├── test-architect.md
│   └── ...                one per role
├── pod-<p>-kanban.md      (fleet.sh)
├── test-pod-kanban.md     (fleet.sh)
└── test-registry.tsv      (fleet.sh)
```

Protocol:
- To send: **append** a dated, sender-tagged block to the recipient's inbox file.
  Never overwrite — inboxes are append-only logs.
- To receive: each session periodically reads its own inbox and marks handled
  entries (e.g. prefix `[x]`). Boundaries where a session must check its inbox:
  before starting work, after a commit, on block, and after each task.
- Keep messages bounded (contracts, notices, status, handoffs). Large payloads go
  in a separate file referenced by path — same rule as pi-peer.
- The kanbans + git + test registry remain authoritative; the inbox only carries
  bounded coordination, exactly as the protocol requires of any message channel.

Message block format (keep it greppable):
```text
## <ISO-time> FROM <sender-role> TO <recipient-role> [CONTRACT|NOTICE|STATUS|HANDOFF|TEST]
<bounded body — or a path reference for large payloads>
```

---

## Choosing an adapter

- Everyone on Pi → **Adapter A** (native, least friction).
- Anyone on ORCA or mixed CLI agents → **Adapter B/C** with **files-as-mailbox**.
  This is the common denominator for a mixed team and is what makes the same wave
  legible to a Claude Code pod and a Codex pod at once.
- When in doubt, default to files-as-mailbox: it costs a little polling but keeps
  the entire fleet on one portable contract, and `fleet.sh` output stays identical.
