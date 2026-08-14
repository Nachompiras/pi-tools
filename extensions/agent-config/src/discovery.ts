import { open, readdir } from "node:fs/promises";
import { constants, lstatSync } from "node:fs";
import { basename, extname, join, sep } from "node:path";
import { homedir } from "node:os";
import type {
  AgentSource,
  AgentSourceKind,
  AgentDirectories,
  DiscoveredAgent,
  AgentScope,
} from "./types.js";

// Precedence order for resolving which source wins for a given name.
const PRECEDENCE: Record<AgentSourceKind, number> = {
  "project-pi": 0,
  "project-agents": 1,
  global: 2,
  builtin: 3,
};

// ---------------------------------------------------------------------------
// validateAgentName
// ---------------------------------------------------------------------------

/**
 * Validate an agent name for safe use as a filename component.
 * Returns the name on success, throws on invalid input.
 *
 * pi-subagents uses case-sensitive Map keys (basename without .md), so names
 * differing only in case are distinct. We preserve the caller's spelling.
 */
export function validateAgentName(name: string): string {
  if (!name || name.length === 0) {
    throw new Error("Agent name must not be empty");
  }

  if (name.includes("\0")) {
    throw new Error("Agent name must not contain NUL characters");
  }

  if (name === "." || name === "..") {
    throw new Error(`Agent name must not be "${name}"`);
  }

  if (name.includes("/") || name.includes("\\")) {
    throw new Error("Agent name must not contain path separators");
  }

  // Reject absolute paths
  if (name.startsWith("/") || (sep === "\\" && /^[a-zA-Z]:\\/.test(name))) {
    throw new Error("Agent name must not be an absolute path");
  }

  // Reject names with traversal
  if (name.includes("..")) {
    throw new Error("Agent name must not contain traversal sequences");
  }

  return name;
}

// ---------------------------------------------------------------------------
// resolveAgentDirectories
// ---------------------------------------------------------------------------

/**
 * Resolve the standard agent directories from a project root and optional
 * global config directory.
 *
 * Project: <cwd>/.pi/agents and <cwd>/.agents/agents
 * Global:  explicit configDir, or PI_CODING_AGENT_DIR, or ~/.pi/agent,
 *          then /agents
 */
export function resolveAgentDirectories(
  cwd: string,
  configDir?: string,
): AgentDirectories {
  const projectPi = join(cwd, ".pi", "agents");
  const projectAgents = join(cwd, ".agents", "agents");

  let globalBase: string;
  if (configDir !== undefined) {
    globalBase = configDir;
  } else if (process.env.PI_CODING_AGENT_DIR) {
    globalBase = process.env.PI_CODING_AGENT_DIR;
  } else {
    globalBase = join(homedir(), ".pi", "agent");
  }

  return {
    projectPi,
    projectAgents,
    global: join(globalBase, "agents"),
  };
}

// ---------------------------------------------------------------------------
// discoverFileAgents
// ---------------------------------------------------------------------------

/**
 * Discover agent definition files (.md only) from the configured directories.
 * Returns sources sorted alphabetically by name.
 *
 * Only regular direct-child .md files are discovered. Nested directories,
 * symlinks, and non-.md files are ignored.
 */
export async function discoverFileAgents(
  directories: AgentDirectories,
): Promise<AgentSource[]> {
  const sources: AgentSource[] = [];

  const scanOrder: Array<{ dir: string; kind: AgentSourceKind }> = [
    { dir: directories.projectPi, kind: "project-pi" },
    { dir: directories.projectAgents, kind: "project-agents" },
    { dir: directories.global, kind: "global" },
  ];

  for (const { dir, kind } of scanOrder) {
    await scanDirectory(dir, kind, sources);
  }

  // Sort alphabetically by name for deterministic output
  sources.sort((a, b) => {
    if (a.name < b.name) return -1;
    if (a.name > b.name) return 1;
    return 0;
  });

  return sources;
}

// ---------------------------------------------------------------------------
// readAgentFile
// ---------------------------------------------------------------------------

/**
 * Whether the platform supports O_NOFOLLOW for atomic symlink refusal.
 * On Linux and macOS this is available; on Windows it is not.
 */
const HAS_O_NOFOLLOW =
  typeof constants.O_NOFOLLOW === "number" && constants.O_NOFOLLOW !== 0;

/**
 * Safely read an agent file, refusing to follow symlinks.
 *
 * On platforms with O_NOFOLLOW (Linux, macOS) the symlink check is atomic
 * with the open call. On platforms without it (Windows), a pre-open lstat
 * check is used as a best-effort defense.
 *
 * Returns the file content as a string, or null if the entry is not a
 * regular file (symlink, directory, device, etc.) or if any error occurs.
 */
async function readAgentFile(filePath: string): Promise<string | null> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    if (HAS_O_NOFOLLOW) {
      handle = await open(
        filePath,
        constants.O_RDONLY | (constants.O_NOFOLLOW as number),
      );
    } else {
      // Best-effort: check before opening (race-prone on this platform)
      const st = lstatSync(filePath);
      if (!st.isFile()) return null;
      handle = await open(filePath, constants.O_RDONLY);
    }

    const st = await handle.stat();
    if (!st.isFile()) return null;

    return await handle.readFile("utf-8");
  } catch {
    // ELOOP: symlink detected by O_NOFOLLOW
    // ENOENT: benign race (file deleted between readdir and open)
    // ENOTDIR, EACCES, etc.: skip unobtrusively
    return null;
  } finally {
    await handle?.close();
  }
}

async function scanDirectory(
  dir: string,
  kind: AgentSourceKind,
  out: AgentSource[],
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  // Sort for deterministic ordering within this directory
  entries.sort();

  for (const entry of entries) {
    if (extname(entry) !== ".md") continue;

    const fullPath = join(dir, entry);

    const content = await readAgentFile(fullPath);
    if (content === null) continue;

    const name = basename(entry, ".md");
    out.push({ name, kind, path: fullPath, content });
  }
}

// ---------------------------------------------------------------------------
// resolveAgentPrecedence
// ---------------------------------------------------------------------------

/**
 * Group agent sources by name (case-sensitive, matching pi-subagents Map
 * behavior) and resolve the effective source per precedence order.
 *
 * Returns DiscoveredAgent entries sorted alphabetically by name.
 * Built-in sources are accepted but not loaded here; they are supplied by the
 * caller later.
 */
export function resolveAgentPrecedence(
  sources: AgentSource[],
): DiscoveredAgent[] {
  // Group by name (case-sensitive)
  const groups = new Map<string, AgentSource[]>();

  for (const source of sources) {
    const existing = groups.get(source.name);
    if (existing) {
      existing.push(source);
    } else {
      groups.set(source.name, [source]);
    }
  }

  const result: DiscoveredAgent[] = [];

  for (const [name, srcs] of groups) {
    // Sort by precedence within the group
    srcs.sort((a, b) => PRECEDENCE[a.kind] - PRECEDENCE[b.kind]);

    result.push({
      name,
      effective: srcs[0],
      sources: srcs,
    });
  }

  // Deterministic alphabetical output
  result.sort((a, b) => {
    if (a.name < b.name) return -1;
    if (a.name > b.name) return 1;
    return 0;
  });

  return result;
}

// ---------------------------------------------------------------------------
// targetAgentPath
// ---------------------------------------------------------------------------

/**
 * Compute the target file path for saving an agent override.
 * - project scope → <projectPi>/<name>.md
 * - global scope  → <global>/<name>.md
 */
export function targetAgentPath(
  name: string,
  scope: AgentScope,
  directories: AgentDirectories,
): string {
  validateAgentName(name);

  if (scope === "project") {
    return join(directories.projectPi, `${name}.md`);
  }

  return join(directories.global, `${name}.md`);
}
