# Nacho's Pi Superpowers

A pi package with my personal toolkit: native subagent support, extension for subagent model configuration, brainstorming workflows, systematic debugging, Rust review/perf, and more.

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

## What's Included

### Extension: Subagent Models

Configure models for subagent-driven-development skill. Provides interactive commands:

- `/subagent-config` - Interactively configure models for each role (cheap, implementer, standard, capable)
- `/subagent-models` - Show current model configuration

Also exposes tools:
- `get_subagent_models` - Get current configuration
- `update_subagent_model` - Update a specific role's model

Default models:
- **cheap**: `minimax/minimax-m2.7` - Mechanical implementation tasks
- **implementer**: `minimax/minimax-m2.7` - Implementation tasks, code writing, and mechanical coding work
- **standard**: `anthropic/claude-sonnet-4.6` - Reviews, integration tasks, multi-file coordination, debugging
- **capable**: `anthropic/claude-opus-4.6` - Architecture, design, planning, broad codebase understanding

### Extension: Subagent

Provides Pi's native `subagent` tool directly from this package.

Included resources:
- `subagent` tool with single, parallel, and chain modes
- Packaged fallback agents: `worker`, `reviewer`, `planner`, `scout`
- Workflow prompts:
  - `/implement`
  - `/scout-and-plan`
  - `/implement-and-review`

Agent resolution priority:
1. Project-local `.pi/agents`
2. User-level `~/.pi/agent/agents`
3. Packaged fallback agents from this package

Packaged fallback role mapping: `scout` → `cheap`, `worker` → `implementer`, `reviewer` → `standard`, `planner` → `capable`

### Skills

| Skill | Description |
|-------|-------------|
| **brainstorming** | Creative work - explores intent, requirements and design before implementation |
| **systematic-debugging** | Use for any bug, test failure, or unexpected behavior - find root cause first |
| **rust-review** | Review Rust code for clippy warnings, idiomatic patterns, error handling, performance |
| **rust-perf** | Deep performance audit and optimization for Rust projects |
| **test-driven-development** | Use before implementing features or bugfixes |
| **writing-plans** | Create detailed implementation plans from specs |
| **requesting-code-review** | Use when completing tasks or before merging |
| **receiving-code-review** | Use when receiving code review feedback |
| **verification-before-completion** | Use before claiming work is complete |
| **frontend-design** | Create distinctive frontend interfaces with high design quality |
| **subagent-driven-development** | Use for independent tasks that can be worked on without shared state |
| **dispatching-parallel-agents** | Use when facing 2+ independent tasks |
| **executing-plans** | Execute multi-step tasks with review checkpoints |
| **finishing-a-development-branch** | Complete development work - guides merge, PR, or cleanup |
| **using-git-worktrees** | Feature work isolation from current workspace |
| **writing-skills** | Create new skills or edit existing ones |
| **find-skills** | Discover and install agent skills |
| **using-superpowers** | Establish how to find and use skills |
| **verification-before-completion** | Run verification commands before claiming success |

## Author

[Nacho](https://github.com/nacho)

## License

MIT
