# Pi Subagents and Vision Migration Design

## Purpose

Migrate this package from `@tintinweb/pi-subagents` to Nicobailon's `pi-subagents` and replace the local `image-label` and `image-describe` extensions with `@getpipher/vision`. Update both the repository and the user's global Pi installation without changing unrelated Pi preferences.

## Selected Approach

Perform a complete, version-pinned migration rather than adding a compatibility shim. Pin `pi-subagents@0.43.0` and `@getpipher/vision@0.5.2` because both projects are evolving quickly and the Nicobailon API is not compatible with Tintinweb's API.

## Subagent Architecture

`pi-subagents` becomes the only subagent runtime. Active skills and prompts must use its public workflow API:

- invoke work through `subagent({ workflowScript })`;
- use `runs.run(...)` for one child or sequential stages;
- use `runs.all(...)` for independent parallel work;
- use top-level `async: true` for background workflows;
- collect asynchronous results with `subagent_wait({ id })`;
- steer work with `subagent({ action: "steer", id, message })`;
- request worktree isolation with `worktree: true`;
- always return the intended value explicitly from `workflowScript`.

The migration must remove active references to Tintinweb's `Agent`, `get_subagent_result`, `steer_subagent`, `subagent_type`, `run_in_background`, and `isolation: "worktree"` interfaces.

## Agent Definitions

Keep the repository's custom agents, including `planner`. Nicobailon's builtin `oracle` is an advisory second-opinion role, not an exact planning replacement.

Expose `agents/` from the package manifest through `pi.subagents.agents`, allowing package installation to discover the definitions automatically. Adapt incompatible frontmatter, including changing `prompt_mode` to `systemPromptMode`. Builtin names may be used where their semantics match, but `planner` remains a package-provided specialization.

## Skills, Prompts, and Documentation

Rewrite every active workflow example and instruction that assumes the Tintinweb tools. This includes the subagent-development and parallel-dispatch skills, implementation prompt templates, architecture workflows, and package setup documentation.

Current usage documentation must name `pi-subagents` and explain its workflow API. Historical plans and specifications may retain historical names when they clearly describe completed past work; active instructions or misleading setup guidance must be corrected.

## Image Handling

Remove both local image extensions:

- `extensions/image-label.ts`;
- `extensions/image-describe/`.

Remove tests and active documentation that exclusively describe those implementations. Install `@getpipher/vision@0.5.2` as an independent Pi package rather than copying its code into this repository. This avoids duplicate attachment interception, image labeling, description calls, compression, and caching.

The replacement is expected to provide numbered image markers, native attachment handling, capability-aware routing, descriptions for text-only models, compression, caching, and fallback behavior. Provider calls performed by the package may transmit image data to the configured model provider.

## Package Changes

In the repository:

- remove `@tintinweb/pi-subagents` from dependencies;
- do not add `pi-subagents` as a Node runtime dependency because this repository does not import it and a nested dependency would not activate its Pi resources;
- document `npm:pi-subagents@0.43.0` as a separately installed Pi package prerequisite;
- expose package agents with `pi.subagents.agents: ["./agents"]` in the manifest;
- regenerate `package-lock.json` from a clean dependency installation;
- remove the local image resources and their obsolete tests;
- remove the obsolete `extensions/discord/` integration and its `discord.js` dependency;
- add `typescript@5.9.3` as a development dependency so the existing `tsconfig.json` has a reproducible compiler;
- migrate the remaining active extension imports from the obsolete `@mariozechner/pi-*` namespace to Pi's current `@earendil-works/pi-*` namespace;
- declare each imported Earendil Pi core package as a `*` peer dependency and remove the obsolete Mario peers;
- leave `extensions/token-speed/` and `tests/token-speed.test.ts` content untouched.

Avoid simultaneously loading Tintinweb and Nicobailon orchestration extensions because they provide overlapping tool and UI concepts.

## Global Installation

Update `~/.pi/agent/settings.json` through Pi's package commands:

1. remove `npm:@tintinweb/pi-subagents`;
2. install `npm:pi-subagents@0.43.0`;
3. install `npm:@getpipher/vision@0.5.2`.

Do not alter API keys, enabled models, default model, theme, or unrelated packages. Preserve the existing installation of this repository.

Before installation, inspect the target package manifests and lifecycle scripts. Pi packages and their extensions execute with the user's full system permissions.

## Error Handling

Workflow examples must return child failures instead of silently discarding them. Asynchronous examples must retain and wait on the returned workflow identifier. Parallel workflows must use one coordinated `runs.all(...)` call so failures and concurrency are managed by the runtime.

If package installation, dependency resolution, or automated verification fails, stop and report the exact failing command. Do not restore the old runtime alongside the new one as an implicit fallback.

## Pi Package Namespace and Security

Use only `@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, and `@earendil-works/pi-tui` in active extensions and peer dependencies. The obsolete Mario package line is affected by published high-severity advisories; removing it must also remove its vulnerable transitive graph from `package-lock.json`. Verify the final production dependency graph with `npm audit --omit=dev`.

## TypeScript Baseline

Make the tracked repository typecheck with TypeScript 5.9.3. Remove Discord rather than repairing its stale API usage. Correct Council's existing type errors without changing runtime behavior: use explicit discriminant checks where TypeScript does not narrow negated booleans, and type model lookup/auth callbacks from the Pi AI model contract.

The only TypeScript file under `skills/` is a pedagogical fragment with intentionally unresolved example imports. Exclude that file from `tsconfig.json` rather than manufacturing fake modules. The untracked `token-speed` implementation remains owned by the other session; this migration changes only the package peer contract needed to resolve its Pi import.

## Verification

Repository verification must include:

- a clean dependency installation or lockfile regeneration;
- the repository's TypeScript 5.9.3 typecheck and existing deterministic test suite;
- checks that Discord and both local image extensions are absent;
- image-related replacement/removal checks;
- searches proving that active files no longer call the Tintinweb API or advertise its installation;
- checks that package agent discovery is declared correctly;
- representative validation of sequential, parallel, asynchronous, steering, and worktree workflow examples.

Global verification must confirm that settings contain the pinned Nicobailon and vision packages and no Tintinweb package. Run `/subagents-doctor` in Pi when it can be automated safely; otherwise provide the exact interactive command to the user.

## Success Criteria

The migration is complete when:

- this package loads without `@tintinweb/pi-subagents`;
- active skills and prompts use valid `pi-subagents@0.43.0` workflow syntax;
- the custom `planner` and other package agents are discoverable;
- neither local image extension nor the Discord extension is loaded;
- `discord.js` and all `@mariozechner/pi-*` packages are absent from the dependency graph;
- active Pi imports and peers use the `@earendil-works` namespace;
- the production npm audit reports no known vulnerabilities;
- `@getpipher/vision@0.5.2` is installed globally;
- TypeScript 5.9.3 typechecks the repository without changing the `token-speed` source;
- unrelated global Pi settings remain unchanged;
- repository verification passes and any required interactive doctor check is clearly reported.
