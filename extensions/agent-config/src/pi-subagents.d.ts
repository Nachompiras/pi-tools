// Type declarations for packages resolved at runtime from
// $PI_CODING_AGENT_DIR/npm/node_modules rather than the project's own
// node_modules directory.

declare module "@tintinweb/pi-subagents/dist/default-agents.js" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const DEFAULT_AGENTS: Map<string, any>;
}
