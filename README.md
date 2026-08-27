# Nacho's Pi Superpowers

A pi package with my personal toolkit: brainstorming workflows, systematic debugging, Rust review/perf, subagent-driven development, and more.

## Installation

```bash
pi install git:github.com/Nachompiras/pi-tools
```

Or try it without installing:

```bash
pi -e git:github.com/Nachompiras/pi-tools
```

To update:

```bash
pi update
```

## Dependencies

Install the subagent runtime and the pinned image workflow package:

```bash
pi install npm:@tintinweb/pi-subagents@^0.15.0
pi install npm:@getpipher/vision@0.5.2
```

[`@tintinweb/pi-subagents`](https://github.com/tintinweb/pi-subagents) provides the `Agent`, `get_subagent_result`, and `steer_subagent` tools. [`@getpipher/vision`](https://github.com/getpipher/vision) owns image labeling, attachment routing, and descriptions for text-only models; this package does not duplicate that behavior.

## Custom Agent Setup

Several skills reference custom agent types defined in `agents/`. Copy them to your global agents directory:

```bash
mkdir -p ~/.pi/agent/agents
cp agents/*.md ~/.pi/agent/agents/
```

This makes the agents available in all projects. To install them for only one project:

```bash
mkdir -p .pi/agents
cp agents/*.md .pi/agents/
```

| Agent | Purpose | Model |
|-------|---------|-------|
| `explore` | Fast codebase exploration (read-only) | openrouter/minimax/minimax-m2.7 |
| `worker` | General-purpose implementation with full tools | deepseek/deepseek-v4-pro |
| `reviewer` | Code review, quality and security analysis (read-only) | openrouter/qwen/qwen3.7-plus |
| `planner` | Implementation planning from context and requirements (read-only) | inherits configured default |
| `scout` | Fast codebase recon for handoff to other agents (read-only) | openrouter/minimax/minimax-m2.7 |
| `quick-worker` | Cheap mechanical implementation for well-specified changes | deepseek/deepseek-v4-pro |
| `deep-worker` | Escalated complex integration work | openrouter/openai/gpt-5.6-sol |
| `deep-reviewer` | Deep code review and security analysis (read-only) | openrouter/openai/gpt-5.6-sol |

These custom definitions work alongside Tintinweb's built-in `general-purpose`, `Explore`, and `Plan` subagent types.

## What's Included

### Extensions

| Extension | Description |
|-----------|-------------|
| **plan-mode** | Read-only exploration mode with plan step tracking |
| **council** | Multi-model review council — sends a spec/plan/code file to multiple LLMs via OpenRouter, runs a 3-stage pipeline (independent review → anonymous peer ranking → chairman synthesis) |
| **agent-config** | Configure agent model, thinking level, and max turns without editing markdown files; validates names, creates timestamped backups, and uses atomic writes with `0600` permissions on POSIX |
| **token-speed** | Preserves Pi's built-in footer and adds live TPS, session-average TPS, and average TTFT |
| **fleet-ops** | Master-side companion to the `orchestrating-agent-fleets` skill. `/como-vamos [wave]` (alias `/fleet-status`) reads `.orchestration/wave-<id>/` and prints per-pod task/agent progress, pod handoff readiness (silent-failure guard), Test Pod evidence, and a "needs attention" list (blocked agents, idle capacity with pending work, stale boards, failed tests) |

#### Council Setup

Create `~/.pi/council.json` with your OpenRouter API key and the models you want on the council:

```json
{
  "apiKey": "sk-or-...",
  "models": [
    "anthropic/claude-sonnet-4-5",
    "openai/gpt-4o",
    "google/gemini-2.5-pro"
  ],
  "chairman": "anthropic/claude-sonnet-4-5",
  "timeout": 120
}
```

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `apiKey` | Yes* | — | OpenRouter API key. Also accepts `OPENROUTER_API_KEY` env var |
| `models` | Yes | — | At least 2 OpenRouter model identifiers |
| `chairman` | No | First model | Model that synthesizes the final verdict |
| `timeout` | No | 120 | Seconds per model request |

**Commands:**

- `/council` — Interactive: choose review type (Spec/Plan/Code), enter file path, optional instructions. Runs the full 3-stage pipeline and shows a compact synthesis + rankings.
- `/council results` — Show full details of the last council run (all individual reviews, peer evaluations, chairman synthesis).

#### Agent Config

- `/agent-config` — Open an agent selector with source and precedence labels.
- `/agent-config <agent-name>` — Jump directly to the dashboard for the named agent.

### Skills

| Skill | Description |
|-------|-------------|
| **brainstorming** | Creative work - explores intent, requirements and design before implementation |
| **systematic-debugging** | Use for any bug, test failure, or unexpected behavior - find root cause first |
| **rust-review** | Review Rust code for clippy warnings, idiomatic patterns, error handling, performance |
| **rust-perf** | Deep performance audit and optimization for Rust projects |
| **auditing-codebase** | Use when auditing a Rust codebase, module, or workspace and wanting cross-model consensus on findings, a false-positive-filtered consolidated report, and a reproducible audit trail in git |
| **test-driven-development** | Use before implementing features or bugfixes |
| **writing-plans** | Create detailed implementation plans from specs |
| **requesting-code-review** | Use when completing tasks or before merging |
| **receiving-code-review** | Use when receiving code review feedback |
| **verification-before-completion** | Use before claiming work is complete |
| **frontend-design** | Create distinctive frontend interfaces with high design quality |
| **subagent-driven-development** | Execute plans with parallel subagents and two-stage review |
| **dispatching-parallel-agents** | Use when facing 2+ independent tasks (in-process subagents, one session) |
| **orchestrating-agent-fleets** | Coordinate multiple long-lived agent sessions in parallel across git worktrees — master/architect/worker/reviewer pods + shared expensive-test dedup; runtime-agnostic (Herdr+Pi, ORCA, tmux) |
| **executing-plans** | Execute multi-step tasks with review checkpoints |
| **finishing-a-development-branch** | Complete development work - guides merge, PR, or cleanup |
| **using-git-worktrees** | Feature work isolation from current workspace |
| **writing-skills** | Create new skills or edit existing ones |
| **find-skills** | Discover and install agent skills |
| **using-superpowers** | Establish how to find and use skills |
| **improve-codebase-architecture** | Find deepening opportunities — refactors that turn shallow modules into deep ones for testability and AI-navigability |

### Prompt Templates

| Prompt | Description |
|--------|-------------|
| `/implement` | Scout → Planner → Worker pipeline |
| `/scout-and-plan` | Scout → Planner (no implementation) |
| `/implement-and-review` | Worker → Reviewer → Worker feedback loop |

## Author

[Nacho](https://github.com/nacho)

## License

MIT
