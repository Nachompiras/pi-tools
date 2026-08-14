import { describe, expect, it } from "vitest";
import {
  writeFile,
  mkdir,
  symlink,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import {
  validateAgentName,
  resolveAgentDirectories,
  discoverFileAgents,
  resolveAgentPrecedence,
  targetAgentPath,
} from "../src/discovery.js";
import type { AgentSource, AgentSourceKind, DiscoveredAgent } from "../src/types.js";

const isWindows = sep === "\\";

// ---------------------------------------------------------------------------
// validateAgentName
// ---------------------------------------------------------------------------
describe("validateAgentName", () => {
  it("accepts valid names including hyphens and case variations", () => {
    expect(validateAgentName("my-agent")).toBe("my-agent");
    expect(validateAgentName("MyAgent")).toBe("MyAgent");
    expect(validateAgentName("my-agent-123")).toBe("my-agent-123");
    expect(validateAgentName("a")).toBe("a");
    expect(validateAgentName("A-B-c")).toBe("A-B-c");
  });

  it("rejects empty string", () => {
    expect(() => validateAgentName("")).toThrow(/name/i);
  });

  it("rejects names with forward slash", () => {
    expect(() => validateAgentName("foo/bar")).toThrow(/name/i);
  });

  it("rejects names with backslash", () => {
    expect(() => validateAgentName("foo\\bar")).toThrow(/name/i);
  });

  it("rejects . as a name", () => {
    expect(() => validateAgentName(".")).toThrow(/name/i);
  });

  it("rejects .. as a name", () => {
    expect(() => validateAgentName("..")).toThrow(/name/i);
  });

  it("rejects traversal sequences", () => {
    expect(() => validateAgentName("../foo")).toThrow(/name/i);
    expect(() => validateAgentName("..\\foo")).toThrow(/name/i);
  });

  it("rejects NUL byte", () => {
    expect(() => validateAgentName("foo\0bar")).toThrow(/name/i);
  });

  it("rejects absolute paths", () => {
    if (!isWindows) {
      expect(() => validateAgentName("/etc/passwd")).toThrow(/name/i);
    }
    // On Windows, absolute paths contain backslash or colon which are already rejected
  });

  it("accepts leading-dot names that are not . or ..", () => {
    expect(validateAgentName(".hidden")).toBe(".hidden");
    expect(validateAgentName(".hidden.md")).toBe(".hidden.md");
    expect(validateAgentName(".config")).toBe(".config");
  });

  it("rejects . and .. only, not all leading-dot names", () => {
    expect(() => validateAgentName(".")).toThrow(/name/i);
    expect(() => validateAgentName("..")).toThrow(/name/i);
  });
});

// ---------------------------------------------------------------------------
// resolveAgentDirectories
// ---------------------------------------------------------------------------
describe("resolveAgentDirectories", () => {
  it("resolves project directories from cwd", () => {
    const dirs = resolveAgentDirectories("/home/user/project");
    expect(dirs.projectPi).toBe("/home/user/project/.pi/agents");
    expect(dirs.projectAgents).toBe("/home/user/project/.agents/agents");
  });

  it("resolves global directory from explicit configDir", () => {
    const dirs = resolveAgentDirectories("/cwd", "/custom/config");
    expect(dirs.global).toBe("/custom/config/agents");
  });

  it("resolves global directory from PI_CODING_AGENT_DIR env var", () => {
    const prev = process.env.PI_CODING_AGENT_DIR;
    try {
      process.env.PI_CODING_AGENT_DIR = "/env/pi/agent";
      const dirs = resolveAgentDirectories("/cwd");
      expect(dirs.global).toBe("/env/pi/agent/agents");
    } finally {
      if (prev === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = prev;
      }
    }
  });

  it("falls back to ~/.pi/agent when env and explicit are missing", () => {
    const prev = process.env.PI_CODING_AGENT_DIR;
    const prevHome = process.env.HOME;
    try {
      delete process.env.PI_CODING_AGENT_DIR;
      process.env.HOME = "/home/testuser";
      const dirs = resolveAgentDirectories("/cwd");
      expect(dirs.global).toBe("/home/testuser/.pi/agent/agents");
    } finally {
      if (prev === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = prev;
      }
      if (prevHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = prevHome;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// discoverFileAgents
// ---------------------------------------------------------------------------
describe("discoverFileAgents", () => {
  it("discovers .md files only", async () => {
    const tmp = await makeTempDir();
    try {
      const agentsDir = join(tmp, "agents");
      await mkdir(agentsDir, { recursive: true });
      await writeFile(join(agentsDir, "alpha.md"), "---\nmodel: m\n---\nbody");
      await writeFile(join(agentsDir, "beta.txt"), "not an agent");
      await writeFile(join(agentsDir, "gamma.json"), "{}");

      const dirs = { projectPi: agentsDir, projectAgents: "/nonexistent1", global: "/nonexistent2" };
      const sources = await discoverFileAgents(dirs);

      expect(sources).toHaveLength(1);
      expect(sources[0].name).toBe("alpha");
      expect(sources[0].kind).toBe("project-pi");
      expect(sources[0].path).toBe(join(agentsDir, "alpha.md"));
      expect(sources[0].content).toBe("---\nmodel: m\n---\nbody");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("ignores nested directories", async () => {
    const tmp = await makeTempDir();
    try {
      const agentsDir = join(tmp, "agents");
      await mkdir(join(agentsDir, "nested"), { recursive: true });
      await writeFile(join(agentsDir, "nested", "hidden.md"), "---\n---\nbody");
      await writeFile(join(agentsDir, "visible.md"), "---\nmodel: v\n---\nvbody");

      const dirs = { projectPi: agentsDir, projectAgents: "/nonexistent1", global: "/nonexistent2" };
      const sources = await discoverFileAgents(dirs);

      expect(sources).toHaveLength(1);
      expect(sources[0].name).toBe("visible");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("returns deterministic alphabetical output", async () => {
    const tmp = await makeTempDir();
    try {
      const agentsDir = join(tmp, "agents");
      await mkdir(agentsDir, { recursive: true });
      await writeFile(join(agentsDir, "zulu.md"), "---\n---\nz");
      await writeFile(join(agentsDir, "alpha.md"), "---\n---\na");
      await writeFile(join(agentsDir, "mike.md"), "---\n---\nm");

      const dirs = { projectPi: agentsDir, projectAgents: "/nonexistent1", global: "/nonexistent2" };
      const sources = await discoverFileAgents(dirs);

      expect(sources.map((s) => s.name)).toEqual(["alpha", "mike", "zulu"]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("discovers from all 3 filesystem locations", async () => {
    const tmp = await makeTempDir();
    try {
      const piDir = join(tmp, "pi");
      const agentsDir = join(tmp, "dotagents");
      const globalDir = join(tmp, "global");
      await mkdir(piDir, { recursive: true });
      await mkdir(agentsDir, { recursive: true });
      await mkdir(globalDir, { recursive: true });

      await writeFile(join(piDir, "pi-agent.md"), "---\n---\npi");
      await writeFile(join(agentsDir, "agents-agent.md"), "---\n---\nagents");
      await writeFile(join(globalDir, "global-agent.md"), "---\n---\nglobal");

      const dirs = {
        projectPi: piDir,
        projectAgents: agentsDir,
        global: globalDir,
      };
      const sources = await discoverFileAgents(dirs);

      expect(sources).toHaveLength(3);
      const names = sources.map((s) => s.name);
      expect(names).toContain("pi-agent");
      expect(names).toContain("agents-agent");
      expect(names).toContain("global-agent");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("handles empty directories", async () => {
    const tmp = await makeTempDir();
    try {
      const piDir = join(tmp, "pi");
      await mkdir(piDir, { recursive: true });

      const dirs = {
        projectPi: piDir,
        projectAgents: join(tmp, "nonexistent-agents"),
        global: join(tmp, "nonexistent-global"),
      };
      const sources = await discoverFileAgents(dirs);

      expect(sources).toEqual([]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("handles missing directories gracefully", async () => {
    const dirs = {
      projectPi: "/tmp/nonexistent-pi-dir-12345",
      projectAgents: "/tmp/nonexistent-agents-dir-12345",
      global: "/tmp/nonexistent-global-dir-12345",
    };
    const sources = await discoverFileAgents(dirs);

    expect(sources).toEqual([]);
  });

  it("discovers leading-dot .md files", async () => {
    const tmp = await makeTempDir();
    try {
      const agentsDir = join(tmp, "agents");
      await mkdir(agentsDir, { recursive: true });
      await writeFile(join(agentsDir, ".hidden.md"), "---\nmodel: h\n---\nhidden");
      await writeFile(join(agentsDir, "visible.md"), "---\nmodel: v\n---\nvisible");

      const dirs = { projectPi: agentsDir, projectAgents: "/nonexistent1", global: "/nonexistent2" };
      const sources = await discoverFileAgents(dirs);

      expect(sources).toHaveLength(2);
      const names = sources.map((s) => s.name);
      expect(names).toContain(".hidden");
      expect(names).toContain("visible");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("does not follow symlink file entries", async () => {
    const tmp = await makeTempDir();
    try {
      const agentsDir = join(tmp, "agents");
      const outsideDir = join(tmp, "outside");
      await mkdir(agentsDir, { recursive: true });
      await mkdir(outsideDir, { recursive: true });

      // Create a real agent file
      await writeFile(join(agentsDir, "real.md"), "---\n---\nreal");

      // Create a symlink to an external file
      await writeFile(join(outsideDir, "external.md"), "---\n---\nexternal");
      await symlink(join(outsideDir, "external.md"), join(agentsDir, "linked.md"));

      // Create a symlink to a directory (should also be ignored)
      await symlink(outsideDir, join(agentsDir, "linked-dir"), "dir");

      const dirs = { projectPi: agentsDir, projectAgents: "/nonexistent1", global: "/nonexistent2" };
      const sources = await discoverFileAgents(dirs);

      // Only the real .md file should be discovered
      expect(sources).toHaveLength(1);
      expect(sources[0].name).toBe("real");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// resolveAgentPrecedence
// ---------------------------------------------------------------------------
describe("resolveAgentPrecedence", () => {
  const makeSource = (
    name: string,
    kind: AgentSourceKind,
    path?: string,
    content?: string,
  ): AgentSource => ({ name, kind, path, content });

  it("returns empty array for empty input", () => {
    expect(resolveAgentPrecedence([])).toEqual([]);
  });

  it("returns deterministic alphabetical output", () => {
    const sources: AgentSource[] = [
      makeSource("zulu", "project-pi"),
      makeSource("alpha", "project-pi"),
      makeSource("mike", "project-pi"),
    ];

    const result = resolveAgentPrecedence(sources);
    expect(result.map((r) => r.name)).toEqual(["alpha", "mike", "zulu"]);
  });

  it("project-pi wins over project-agents", () => {
    const sources: AgentSource[] = [
      makeSource("agent1", "project-agents", "/p/.agents/agents/agent1.md", "agents-content"),
      makeSource("agent1", "project-pi", "/p/.pi/agents/agent1.md", "pi-content"),
    ];

    const result = resolveAgentPrecedence(sources);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("agent1");
    expect(result[0].effective.kind).toBe("project-pi");
    expect(result[0].effective.content).toBe("pi-content");
    expect(result[0].sources).toHaveLength(2);
    expect(result[0].sources[0].kind).toBe("project-pi");
    expect(result[0].sources[1].kind).toBe("project-agents");
  });

  it("project-agents wins over global", () => {
    const sources: AgentSource[] = [
      makeSource("agent1", "global", "/g/agents/agent1.md", "global-content"),
      makeSource("agent1", "project-agents", "/p/.agents/agents/agent1.md", "agents-content"),
    ];

    const result = resolveAgentPrecedence(sources);
    expect(result[0].effective.kind).toBe("project-agents");
    expect(result[0].effective.content).toBe("agents-content");
    expect(result[0].sources).toHaveLength(2);
  });

  it("global wins over builtin", () => {
    const sources: AgentSource[] = [
      makeSource("agent1", "builtin", undefined, "builtin-content"),
      makeSource("agent1", "global", "/g/agents/agent1.md", "global-content"),
    ];

    const result = resolveAgentPrecedence(sources);
    expect(result[0].effective.kind).toBe("global");
    expect(result[0].effective.content).toBe("global-content");
    expect(result[0].sources).toHaveLength(2);
  });

  it("retains all shadowed sources", () => {
    const sources: AgentSource[] = [
      makeSource("agent1", "builtin", undefined, "builtin"),
      makeSource("agent1", "global", "/g/agent1.md", "global"),
      makeSource("agent1", "project-agents", "/a/agent1.md", "agents"),
      makeSource("agent1", "project-pi", "/p/agent1.md", "pi"),
    ];

    const result = resolveAgentPrecedence(sources);
    expect(result).toHaveLength(1);
    expect(result[0].effective.kind).toBe("project-pi");
    expect(result[0].sources).toHaveLength(4);
    expect(result[0].sources.map((s) => s.kind)).toEqual([
      "project-pi",
      "project-agents",
      "global",
      "builtin",
    ]);
  });

  it("duplicate names are case-sensitive (match pi-subagents Map behavior)", () => {
    const sources: AgentSource[] = [
      makeSource("Agent", "project-pi", "/p/Agent.md", "pi"),
      makeSource("agent", "global", "/g/agent.md", "global"),
    ];

    const result = resolveAgentPrecedence(sources);
    // Case-sensitive: "Agent" and "agent" are different names
    expect(result).toHaveLength(2);
    const names = result.map((r) => r.name);
    expect(names).toContain("Agent");
    expect(names).toContain("agent");
  });

  it("preserves actual filename spelling for display and writes", () => {
    const sources: AgentSource[] = [
      makeSource("MyAgent", "project-pi", "/p/MyAgent.md", "content"),
    ];

    const result = resolveAgentPrecedence(sources);
    expect(result[0].name).toBe("MyAgent");
    expect(result[0].effective.name).toBe("MyAgent");
  });

  it("handles multiple distinct names across all levels", () => {
    const sources: AgentSource[] = [
      makeSource("a", "project-pi"),
      makeSource("b", "project-agents"),
      makeSource("c", "global"),
      makeSource("d", "builtin"),
    ];

    const result = resolveAgentPrecedence(sources);
    expect(result.map((r) => r.name)).toEqual(["a", "b", "c", "d"]);
    for (const r of result) {
      expect(r.sources).toHaveLength(1);
    }
  });
});

// ---------------------------------------------------------------------------
// targetAgentPath
// ---------------------------------------------------------------------------
describe("targetAgentPath", () => {
  const dirs = {
    projectPi: "/project/.pi/agents",
    projectAgents: "/project/.agents/agents",
    global: "/home/user/.pi/agent/agents",
  };

  it("project target always under .pi/agents", () => {
    const path = targetAgentPath("my-agent", "project", dirs);
    expect(path).toBe("/project/.pi/agents/my-agent.md");
  });

  it("global target under config dir", () => {
    const path = targetAgentPath("my-agent", "global", dirs);
    expect(path).toBe("/home/user/.pi/agent/agents/my-agent.md");
  });

  it("target remains direct child of target directory", () => {
    // Even with a valid name, the result should be a direct child
    const path = targetAgentPath("my-agent-name", "project", dirs);
    expect(path).toBe("/project/.pi/agents/my-agent-name.md");
    // Should not contain any subdirectory structure
    expect(path).not.toContain("/my-agent-name/");
  });

  it("leading-dot names produce a direct child, not a traversal", () => {
    const path = targetAgentPath(".hidden", "project", dirs);
    expect(path).toBe("/project/.pi/agents/.hidden.md");
    expect(path).not.toContain("/../");
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function makeTempDir(): Promise<string> {
  const prefix = join(tmpdir(), "agent-config-test-");
  const dir = prefix + randomSuffix();
  await mkdir(dir, { recursive: true });
  return dir;
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}
