# Agent Config Extension

Interactive Pi extension for configuring a subagent's model, thinking level, and maximum turns without manually editing agent Markdown files.

## Installation

This extension is included in the `pi-tools` package and is auto-discovered when installed via:

```bash
pi install git:github.com/Nachompiras/pi-tools
```

**Package compatibility**: This extension integrates with `@tintinweb/pi-subagents` 0.15.x, which is declared as a root dependency (`^0.15.0`). It discovers built-in agents from that package's exported definitions and relies on the same source-precedence model.

Restart Pi or run `/reload` to activate the command.

## Commands

```text
/agent-config
/agent-config <agent-name>
```

`/agent-config` opens an agent selector with source and precedence labels. `/agent-config <agent-name>` skips the selector and jumps directly to the dashboard for the named agent.

## Source precedence

Agent definitions are discovered from four locations in effective precedence order:

| Precedence | Location | Label |
|------------|----------|-------|
| 1 (highest) | `<project>/.pi/agents/<name>.md` | project `.pi/agents` |
| 2 | `<project>/.agents/agents/<name>.md` | project `.agents/agents` |
| 3 | `$PI_CODING_AGENT_DIR/agents/<name>.md` (defaults to `~/.pi/agent/agents/`) | global |
| 4 (lowest) | Built-in agents from `@tintinweb/pi-subagents` | built-in |

When duplicate names exist, the highest-precedence definition wins. The selector shows both the effective source and any shadowed definitions.

## Project and global overrides

You can configure either a **project** or **global** scope:

- **Project overrides** are written to `.pi/agents/<name>.md` and apply only to the current project. A project override shadows any global or built-in definition of the same name.
- **Global overrides** are written to `$PI_CODING_AGENT_DIR/agents/<name>.md` and apply to all projects that do not have a project-level override of the same name.

The UI warns when:

- A project override will shadow an existing global or built-in definition.
- A global edit will not affect the current project because a project-level definition already wins.

## Configurable fields

### Model

The model editor uses a single searchable selector component that presents:

1. **Pinned actions** — "Inherit (use default)" and "Enter model manually..." are always visible at the top, regardless of search query.
2. **All available models** — all currently available models from configured providers are shown. A refresh is attempted for up to 15 seconds before the selector opens; on timeout or rejection, cached available models are shown with a warning. Enabled models (matching `enabledModels` from settings) are pinned first and marked with a checkmark. Non-enabled models follow in deterministic provider/id order.
3. **Live search** — typing filters the model list in real time with case-insensitive, Unicode-normalized matching across model id, provider, full `provider/model-id`, and display name. Clearing the query restores the full unfiltered list.
4. **Bounded viewport** — the model list is scrollable with a fixed viewport; a scroll indicator shows the current position.
5. **No-results** — when no models match the search query, a "No matching models" message is shown while the pinned actions remain accessible.
6. **Manual entry** — the "Enter model manually..." action accepts a free-form `provider/model-id` or fuzzy model name. The value is validated for format (rejects empty, control characters, and multiline input).

**Keyboard navigation**: arrow keys (up/down), Enter (select), Escape (cancel), and Backspace (clear/delete). The search field, pinned actions, and scrollable model list form a single integrated component.

Selections are stored as full `provider/model-id` values.

> **Note**: The searchable model selector is only available in interactive TUI mode (`/agent-config` is an interactive command). Non-TUI modes receive a notification directing the user to the TUI.

### Thinking level

Available levels: Inherit, Off, Minimal, Low, Medium, High, XHigh, Max.

Choosing **Inherit** removes the `thinking` field. Explicit values are stored in lowercase.

### Maximum turns

The selector offers **Inherit** (removes `max_turns`) or a **positive integer** entered by the user. Version 1 does not write `0` to avoid ambiguity between unlimited and inherited defaults.

## Inheritance

Each field can be inherited independently. Choosing "Inherit" for a field removes it from the agent's YAML frontmatter, letting the parent or built-in default take effect. Other fields are unaffected.

## Built-in agents

Built-in agents from `@tintinweb/pi-subagents` are selectable. When a built-in has no editable file on disk, the extension copies the complete built-in definition (system prompt, tools, extensions, skills, and all metadata) into the target scope before applying your configuration changes.

If the installed package does not expose a definition reliably, the extension stops with instructions to eject the built-in agent first through `/agents`. An ejected definition can then be configured normally.

## Safety and file handling

Before saving, the extension:

1. Validates the agent name and rejects path traversal.
2. Validates model, thinking, and maximum-turn values.
3. Resolves and displays the exact target path.
4. Refuses to replace a symbolic link target.
5. Shows a before/after summary with field-level changes.
6. Asks for explicit confirmation.

On confirmation, the extension:

1. Creates the target directory if necessary.
2. Preserves the prompt body and unrelated frontmatter fields.
3. Creates a timestamped backup (UTC ISO format) when replacing an existing definition.
4. Writes a temporary file in the target directory.
5. Atomically renames the temporary file over the target.
6. Sets file permissions to `0600` on POSIX platforms (both the saved file and any backup). On POSIX, an existing file with more permissive permissions is tightened to `0600`.
7. Reports the saved path and backup path (if any).
8. Reloads Pi resources so subsequent subagents use the new configuration.

A failed validation or write leaves the original definition untouched and reports an actionable error. Reload is only triggered after a successful save.

## Recovery

If a bad override, reset, or accidental deletion causes problems:

- **Restore from backup** — backups are saved in the same directory with a timestamped `.bak` extension (e.g., `reviewer.2025-01-15T12-00-00Z.bak`).
- **Delete the override** — removing the project or global `.md` file restores the next-precedence definition.
- **Eject through `/agents`** — use the built-in `/agents` command to re-eject a built-in agent to its default configuration.

## Non-goals

Version 1 does not manage:

- Tool or extension access (`tools`, `extensions`, `disallowed_tools`, etc.)
- Agent prompt text (`systemPrompt` body)
- Enable/disable state
- Agent deletion
- Concurrency or global subagent settings
- Reusable configuration profiles
- LLM-callable configuration tools

These can be considered after the core workflow is validated.

## Manual testing

> **Status**: Automated checks (527 tests, 11 test files, typecheck, git diff --check) pass.

## Development

```bash
npm install
npm test                # Run all tests (Vitest)
npm run typecheck       # TypeScript type checking
```