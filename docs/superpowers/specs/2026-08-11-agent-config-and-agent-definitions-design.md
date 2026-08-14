# Agent Config and Agent Definitions Design

## Goal

Publish the finalized local `agent-config` extension and custom agent definitions as part of `pi-tools`, ready for review in a focused pull request.

## Scope

The change will:

- add the `agent-config` extension runtime, tests, README, and TypeScript configuration;
- update the five existing packaged agents from the finalized local definitions;
- add `quick-worker`, `deep-worker`, and `deep-reviewer`;
- integrate the extension's runtime dependencies and test commands into the root package;
- document the extension and complete agent set in the root README;
- align active documentation and runtime integration with `@tintinweb/pi-subagents` 0.15.x;
- verify the extension through automated tests, type checking, root tests, and a local Pi load smoke test.

The import will exclude the standalone extension repository's nested `.git/`, `node_modules/`, historical development plans/specifications, and agent backup files.

## Architecture

`extensions/agent-config/` will become a normal multi-file Pi extension inside the existing package. It remains responsible for agent discovery, YAML frontmatter updates, model selection, safe persistence, backups, and resource reloads. Shared runtime dependencies belong in the root `package.json` because Pi installs and loads `pi-tools` as one package.

The canonical packaged agents remain Markdown definitions under `agents/`. Tintinweb infers each agent name from its filename and consumes its YAML frontmatter. The local global copies are import sources only; the PR does not modify the active files under `~/.pi/agent/`.

## Agent Set

The packaged set will contain:

- `explore`: bounded targeted lookup;
- `scout`: integration reconnaissance;
- `planner`: bounded planning from verified facts;
- `quick-worker`: cheap mechanical implementation;
- `worker`: routine bounded implementation;
- `deep-worker`: escalated complex integration work;
- `reviewer`: focused correctness review;
- `deep-reviewer`: deep integration and security review.

The definitions use Tintinweb-compatible fields such as `prompt_mode`, `thinking`, and `max_turns`. Unsupported `multi_grep` will not be included.

## Integration and Compatibility

The extension will target the currently packaged `@tintinweb/pi-subagents` 0.15.x runtime. Existing standalone references to the previously tested 0.14.3 version will be updated. Built-in agent discovery must continue to use supported Tintinweb paths and metadata without introducing a second subagent runtime.

The package's existing council, token-speed, skills, prompts, and agents remain available. Root test orchestration will include the extension's tests while preserving existing suites.

## Safety and Error Handling

The imported extension retains its existing safety model:

- validate agent names and editable values;
- preserve prompt bodies and unrelated frontmatter;
- reject symbolic-link replacement;
- show the target and before/after summary;
- require confirmation;
- create timestamped backups;
- use temporary files and atomic replacement;
- reload only after a successful save.

Integration work must not copy generated dependencies, nested Git metadata, backups, or unrelated historical documents.

## Verification

Acceptance requires:

1. Agent definitions satisfy the Tintinweb frontmatter contract and contain only supported built-in tools.
2. All imported `agent-config` tests pass from the package checkout.
3. TypeScript type checking passes.
4. Existing `pi-tools` tests pass.
5. `git diff --check` passes.
6. Pi can load the package/extension and expose the `/agent-config` command in a representative local smoke test.
7. The final branch contains only the approved files and documentation changes.

## Delivery

Work will be committed on `feature/agent-config`, pushed to `origin`, and submitted as a GitHub pull request against `main` with a summary and verification evidence.
