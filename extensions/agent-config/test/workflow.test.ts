import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { runAgentConfigWorkflow } from "../src/workflow.js";
import type {
  AgentConfigUi,
  AgentConfigWorkflowDependencies,
  AgentConfigWorkflowResult,
  AgentSource,
  ModelDescriptor,
  ModelSelection,
  ModelSelectorOptions,
} from "../src/types.js";
import { parseAgentDocument } from "../src/frontmatter.js";

// ---------------------------------------------------------------------------
// FakeUi
// ---------------------------------------------------------------------------

type UiCall =
  | { kind: "select"; title: string; options: string[] }
  | { kind: "selectModel"; options: ModelSelectorOptions }
  | { kind: "input"; title: string; placeholder?: string }
  | { kind: "confirm"; title: string; message: string }
  | { kind: "notify"; message: string; level: "info" | "warning" | "error" };

class FakeUi implements AgentConfigUi {
  calls: UiCall[] = [];

  private selectResponses: Array<string | undefined> = [];
  private selectModelResponses: Array<ModelSelection | undefined> = [];
  private inputResponses: Array<string | undefined> = [];
  private confirmResponses: boolean[] = [];

  enqueueSelect(response: string | undefined): this {
    this.selectResponses.push(response);
    return this;
  }

  enqueueSelects(responses: Array<string | undefined>): this {
    this.selectResponses.push(...responses);
    return this;
  }

  enqueueSelectModel(response: ModelSelection | undefined): this {
    this.selectModelResponses.push(response);
    return this;
  }

  enqueueSelectModels(responses: Array<ModelSelection | undefined>): this {
    this.selectModelResponses.push(...responses);
    return this;
  }

  enqueueInput(response: string | undefined): this {
    this.inputResponses.push(response);
    return this;
  }

  enqueueInputs(responses: Array<string | undefined>): this {
    this.inputResponses.push(...responses);
    return this;
  }

  enqueueConfirm(response: boolean): this {
    this.confirmResponses.push(response);
    return this;
  }

  enqueueConfirms(responses: boolean[]): this {
    this.confirmResponses.push(...responses);
    return this;
  }

  async select(title: string, options: string[]): Promise<string | undefined> {
    this.calls.push({ kind: "select", title, options });
    const r = this.selectResponses.shift();
    return r;
  }

  async selectModel(options: ModelSelectorOptions): Promise<ModelSelection | undefined> {
    this.calls.push({ kind: "selectModel", options });
    return this.selectModelResponses.shift();
  }

  async input(title: string, placeholder?: string): Promise<string | undefined> {
    this.calls.push({ kind: "input", title, placeholder });
    const r = this.inputResponses.shift();
    return r;
  }

  async confirm(title: string, message: string): Promise<boolean> {
    this.calls.push({ kind: "confirm", title, message });
    const r = this.confirmResponses.shift();
    return r ?? false;
  }

  notify(message: string, level: "info" | "warning" | "error"): void {
    this.calls.push({ kind: "notify", message, level });
  }

  /** Return the last call of a given kind */
  lastCall<K extends UiCall["kind"]>(kind: K): Extract<UiCall, { kind: K }> | undefined {
    for (let i = this.calls.length - 1; i >= 0; i--) {
      if (this.calls[i].kind === kind) return this.calls[i] as Extract<UiCall, { kind: K }>;
    }
    return undefined;
  }

  /** Return all calls of a given kind */
  callsOf<K extends UiCall["kind"]>(kind: K): Extract<UiCall, { kind: K }>[] {
    return this.calls.filter((c): c is Extract<UiCall, { kind: K }> => c.kind === kind);
  }

  /** Assert no unconsumed responses */
  assertNoUnconsumed(): void {
    if (this.selectResponses.length > 0) {
      throw new Error(`${this.selectResponses.length} unconsumed select responses`);
    }
    if (this.selectModelResponses.length > 0) {
      throw new Error(`${this.selectModelResponses.length} unconsumed selectModel responses`);
    }
    if (this.inputResponses.length > 0) {
      throw new Error(`${this.inputResponses.length} unconsumed input responses`);
    }
    if (this.confirmResponses.length > 0) {
      throw new Error(`${this.confirmResponses.length} unconsumed confirm responses`);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "workflow-test-"));
}

function makeAgentSource(
  name: string,
  kind: AgentSource["kind"],
  content: string,
  filePath?: string,
): AgentSource {
  return { name, kind, content, path: filePath };
}

const sampleAgentContent = `---
model: anthropic/claude-sonnet-4-20250514
thinking: high
max_turns: 20
description: A sample agent
tools: all
---
System prompt body here.
`;

const noModelAgentContent = `---
description: No model agent
tools: read, bash
---
Just a body.
`;

const builtinAgentContent = `---
description: Built-in explorer
tools: read, bash, grep, find, ls
prompt_mode: replace
---
You are an explorer agent.
`;

const malformedValuesContent = `---
model: 123
thinking: invalid_level
max_turns: -5
extra: kept
---
Body with malformed values.
`;

function makeDeps(
  ui: FakeUi,
  overrides: Partial<AgentConfigWorkflowDependencies> = {},
): AgentConfigWorkflowDependencies {
  return {
    ui,
    cwd: "/fake/project",
    configDir: "/fake/global-config",
    allModels: [
      { provider: "anthropic", id: "claude-sonnet-4-20250514" },
      { provider: "anthropic", id: "claude-opus-4-8" },
      { provider: "openai", id: "gpt-5" },
    ],
    enabledModelPatterns: ["anthropic/*"],
    builtinSources: [],
    ...overrides,
  };
}

async function setupProjectWithAgent(
  agentName: string,
  content: string,
): Promise<{ dir: string; cwd: string; source: AgentSource }> {
  const dir = tmpdir();
  const cwd = dir;
  const agentsDir = path.join(dir, ".pi", "agents");
  await fsp.mkdir(agentsDir, { recursive: true });
  const filePath = path.join(agentsDir, `${agentName}.md`);
  await fsp.writeFile(filePath, content, "utf-8");
  return {
    dir,
    cwd,
    source: makeAgentSource(agentName, "project-pi", content, filePath),
  };
}

async function setupGlobalAgent(
  agentName: string,
  content: string,
): Promise<{ dir: string; configDir: string; source: AgentSource }> {
  const dir = tmpdir();
  const configDir = dir;
  const agentsDir = path.join(dir, "agents");
  await fsp.mkdir(agentsDir, { recursive: true });
  const filePath = path.join(agentsDir, `${agentName}.md`);
  await fsp.writeFile(filePath, content, "utf-8");
  return {
    dir,
    configDir,
    source: makeAgentSource(agentName, "global", content, filePath),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runAgentConfigWorkflow", () => {
  // -----------------------------------------------------------------------
  // No agents found
  // -----------------------------------------------------------------------

  it("notifies and returns unsaved when no agents discovered", async () => {
    const ui = new FakeUi();
    const deps = makeDeps(ui);
    const result = await runAgentConfigWorkflow(undefined, deps);
    expect(result.saved).toBe(false);
    expect(result.reloadRequired).toBe(false);
    const lastNotify = ui.lastCall("notify");
    expect(lastNotify).toBeDefined();
    expect((lastNotify as any).level).toBe("warning");
    expect((lastNotify as any).message).toMatch(/no agents/i);
  });

  // -----------------------------------------------------------------------
  // Direct argument: unknown agent
  // -----------------------------------------------------------------------

  it("notifies error for unknown requested agent", async () => {
    const ui = new FakeUi();
    const { dir, cwd, source } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      const result = await runAgentConfigWorkflow("unknown-agent", deps);
      expect(result.saved).toBe(false);
      expect(result.reloadRequired).toBe(false);
      const lastNotify = ui.lastCall("notify");
      expect(lastNotify).toBeDefined();
      expect((lastNotify as any).level).toBe("error");
      expect((lastNotify as any).message).toContain("unknown-agent");
      expect((lastNotify as any).message).toContain("my-agent");
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------------
  // Direct argument: valid agent name
  // -----------------------------------------------------------------------

  it("accepts valid direct agent name and proceeds to scope selection", async () => {
    const ui = new FakeUi();
    const { dir, cwd, source } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      // Select scope: project
      ui.enqueueSelect("Project (.pi/agents)");
      // Dashboard: cancel
      ui.enqueueSelect("Cancel");

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      const result = await runAgentConfigWorkflow("my-agent", deps);
      expect(result.saved).toBe(false);
      expect(result.reloadRequired).toBe(false);

      // Verify scope selection was shown
      const scopeCall = ui.calls.find((c) => c.kind === "select" && c.title.includes("scope"));
      expect(scopeCall).toBeDefined();
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------------
  // Interactive selection with labels
  // -----------------------------------------------------------------------

  it("shows agent labels with source info", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      // Select agent, then scope, then cancel dashboard
      ui.enqueueSelect("my-agent (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      ui.enqueueSelect("Cancel");

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      await runAgentConfigWorkflow(undefined, deps);

      const agentSelectCall = ui.calls.find((c) => c.kind === "select" && c.title.includes("Select agent"));
      expect(agentSelectCall).toBeDefined();
      expect((agentSelectCall as any).options).toContain("my-agent (project .pi/agents)");
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------------
  // Labels show shadow precedence
  // -----------------------------------------------------------------------

  it("shows shadow info when multiple sources exist", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    const { dir: globalDir, configDir, source: globalSource } = await setupGlobalAgent("my-agent", "---\nmodel: global-model\n---\nGlobal body.");
    try {
      // Select agent, then scope, then cancel
      ui.enqueueSelect("my-agent (project .pi/agents — shadows global)");
      ui.enqueueSelect("Project (.pi/agents)");
      ui.enqueueSelect("Cancel");

      const deps = makeDeps(ui, {
        cwd,
        configDir,
        builtinSources: [globalSource],
      });
      await runAgentConfigWorkflow(undefined, deps);

      const agentSelectCall = ui.calls.find((c) => c.kind === "select" && c.title.includes("Select agent"));
      expect(agentSelectCall).toBeDefined();
      const options: string[] = (agentSelectCall as any).options;
      expect(options.some((o: string) => o.includes("shadows global"))).toBe(true);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
      await fsp.rm(globalDir, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------------
  // Cancellation at agent selection
  // -----------------------------------------------------------------------

  it("returns unsaved when agent selection cancelled", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      ui.enqueueSelect(undefined); // cancel

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      const result = await runAgentConfigWorkflow(undefined, deps);
      expect(result.saved).toBe(false);
      expect(result.reloadRequired).toBe(false);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------------
  // Cancellation at scope selection
  // -----------------------------------------------------------------------

  it("returns unsaved when scope selection cancelled", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      ui.enqueueSelect("my-agent (project .pi/agents)");
      ui.enqueueSelect(undefined); // cancel scope

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      const result = await runAgentConfigWorkflow(undefined, deps);
      expect(result.saved).toBe(false);
      expect(result.reloadRequired).toBe(false);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------------
  // Project shadow warning
  // -----------------------------------------------------------------------

  it("shows shadow warning when selecting project scope over global/builtin", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    const { dir: globalDir, configDir } = await setupGlobalAgent("my-agent", "---\nmodel: global\n---\nGlobal.");
    try {
      ui.enqueueSelect("my-agent (project .pi/agents — shadows global)");
      ui.enqueueSelect("Project (.pi/agents)");
      ui.enqueueConfirm(true); // acknowledge shadow warning
      ui.enqueueSelect("Cancel"); // dashboard cancel

      const deps = makeDeps(ui, {
        cwd,
        configDir,
        builtinSources: [
          makeAgentSource("my-agent", "global", "---\nmodel: global\n---\nGlobal.", path.join(globalDir, "agents", "my-agent.md")),
        ],
      });
      await runAgentConfigWorkflow(undefined, deps);

      const confirmCall = ui.calls.find((c) => c.kind === "confirm" && c.title.includes("Shadow"));
      expect(confirmCall).toBeDefined();
      expect((confirmCall as any).message).toMatch(/override/i);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
      await fsp.rm(globalDir, { recursive: true, force: true });
    }
  });

  it("cancels when shadow warning declined", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    const { dir: globalDir, configDir } = await setupGlobalAgent("my-agent", "---\nmodel: global\n---\nGlobal.");
    try {
      ui.enqueueSelect("my-agent (project .pi/agents — shadows global)");
      ui.enqueueSelect("Project (.pi/agents)");
      ui.enqueueConfirm(false); // decline shadow warning

      const deps = makeDeps(ui, {
        cwd,
        configDir,
        builtinSources: [
          makeAgentSource("my-agent", "global", "---\nmodel: global\n---\nGlobal.", path.join(globalDir, "agents", "my-agent.md")),
        ],
      });
      const result = await runAgentConfigWorkflow(undefined, deps);
      expect(result.saved).toBe(false);
      expect(result.reloadRequired).toBe(false);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
      await fsp.rm(globalDir, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------------
  // Global shadow warning when project exists
  // -----------------------------------------------------------------------

  it("shows shadow warning when selecting global scope with existing project def", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    const { dir: globalDir, configDir } = await setupGlobalAgent("my-agent", "---\nmodel: global\n---\nGlobal.");
    try {
      ui.enqueueSelect("my-agent (project .pi/agents — shadows global)");
      ui.enqueueSelect("Global");
      ui.enqueueConfirm(true); // acknowledge shadow warning
      ui.enqueueSelect("Cancel");

      const deps = makeDeps(ui, {
        cwd,
        configDir,
        builtinSources: [
          makeAgentSource("my-agent", "global", "---\nmodel: global\n---\nGlobal.", path.join(globalDir, "agents", "my-agent.md")),
        ],
      });
      await runAgentConfigWorkflow(undefined, deps);

      const confirmCall = ui.calls.find((c) => c.kind === "confirm" && c.title.includes("Shadow"));
      expect(confirmCall).toBeDefined();
      expect((confirmCall as any).message).toMatch(/project/i);
      expect((confirmCall as any).message).toMatch(/precedence/i);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
      await fsp.rm(globalDir, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------------
  // Copying full effective definition (builtin base)
  // -----------------------------------------------------------------------

  it("copies effective content when no existing file at chosen scope", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("other", "---\n---\nOther.");
    try {
      // Agent is only available as builtin
      ui.enqueueSelect("builtin-agent (built-in)");
      ui.enqueueSelect("Project (.pi/agents)");
      ui.enqueueConfirm(true); // shadow warning (builtin shadowed)
      // Dashboard — edit model, select from enabled, then save
      ui.enqueueSelect("Edit model");
      ui.enqueueSelectModel({ kind: "model", value: "anthropic/claude-sonnet-4-20250514" });
      ui.enqueueSelect("Save");
      ui.enqueueConfirm(true); // confirm save

      const deps = makeDeps(ui, {
        cwd,
        configDir: dir,
        builtinSources: [makeAgentSource("builtin-agent", "builtin", builtinAgentContent)],
      });
      const result = await runAgentConfigWorkflow(undefined, deps);
      expect(result.saved).toBe(true);
      expect(result.reloadRequired).toBe(true);
      expect(result.path).toBeDefined();
      expect(result.path).toContain("builtin-agent.md");

      // Verify file was written with full builtin content + model update
      const written = fs.readFileSync(result.path!, "utf-8");
      const doc = parseAgentDocument(written);
      expect(doc.frontmatter.description).toBe("Built-in explorer");
      expect(doc.frontmatter.tools).toBe("read, bash, grep, find, ls");
      expect(doc.frontmatter.model).toBe("anthropic/claude-sonnet-4-20250514");
      expect(doc.body).toContain("You are an explorer agent");
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------------
  // Unavailable content refusal
  // -----------------------------------------------------------------------

  it("refuses when effective source has no content", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("other", "---\n---\nOther.");
    try {
      // Agent only as builtin with no content
      ui.enqueueSelect("no-content-agent (built-in)");
      ui.enqueueSelect("Project (.pi/agents)");
      ui.enqueueConfirm(true); // shadow warning (builtin shadowed)

      const deps = makeDeps(ui, {
        cwd,
        configDir: dir,
        builtinSources: [makeAgentSource("no-content-agent", "builtin", undefined as unknown as string)],
      });
      const result = await runAgentConfigWorkflow(undefined, deps);
      expect(result.saved).toBe(false);
      expect(result.reloadRequired).toBe(false);

      const lastNotify = ui.lastCall("notify");
      expect(lastNotify).toBeDefined();
      expect((lastNotify as any).message).toMatch(/no content/i);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------------
  // Malformed values display and replacement
  // -----------------------------------------------------------------------

  it("displays malformed values and allows replacement", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("malformed", malformedValuesContent);
    try {
      ui.enqueueSelect("malformed (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      // Dashboard shows malformed values
      // Edit model to inherit
      ui.enqueueSelect("Edit model");
      ui.enqueueSelectModel({ kind: "inherit" });
      // Edit thinking to valid
      ui.enqueueSelect("Edit thinking");
      ui.enqueueSelect("medium");
      // Edit max turns to valid
      ui.enqueueSelect("Edit max turns");
      ui.enqueueSelect("Enter value...");
      ui.enqueueInput("10");
      // Save
      ui.enqueueSelect("Save");
      ui.enqueueConfirm(true);

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      const result = await runAgentConfigWorkflow(undefined, deps);
      expect(result.saved).toBe(true);
      expect(result.reloadRequired).toBe(true);

      const written = fs.readFileSync(result.path!, "utf-8");
      const doc = parseAgentDocument(written);
      // Model should be removed (inherit)
      expect(doc.frontmatter).not.toHaveProperty("model");
      // Thinking should be updated
      expect(doc.frontmatter.thinking).toBe("medium");
      // Max turns should be updated
      expect(doc.frontmatter.max_turns).toBe(10);
      // Unrelated field preserved
      expect(doc.frontmatter.extra).toBe("kept");
      expect(doc.body).toBe("Body with malformed values.\n");
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------------
  // Dashboard multi-edit cycle
  // -----------------------------------------------------------------------

  it("allows editing multiple fields before save", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      ui.enqueueSelect("my-agent (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      // Edit model
      ui.enqueueSelect("Edit model");
      ui.enqueueSelectModel({ kind: "model", value: "anthropic/claude-opus-4-8" });
      // Edit thinking
      ui.enqueueSelect("Edit thinking");
      ui.enqueueSelect("off");
      // Edit max turns
      ui.enqueueSelect("Edit max turns");
      ui.enqueueSelect("Enter value...");
      ui.enqueueInput("30");
      // Save
      ui.enqueueSelect("Save");
      ui.enqueueConfirm(true);

      const deps = makeDeps(ui, {
        cwd,
        configDir: dir,
        allModels: [
          { provider: "anthropic", id: "claude-sonnet-4-20250514" },
          { provider: "anthropic", id: "claude-opus-4-8" },
        ],
        enabledModelPatterns: ["anthropic/*"],
        builtinSources: [],
      });
      const result = await runAgentConfigWorkflow(undefined, deps);
      expect(result.saved).toBe(true);
      expect(result.reloadRequired).toBe(true);

      const written = fs.readFileSync(result.path!, "utf-8");
      const doc = parseAgentDocument(written);
      expect(doc.frontmatter.model).toBe("anthropic/claude-opus-4-8");
      expect(doc.frontmatter.thinking).toBe("off");
      expect(doc.frontmatter.max_turns).toBe(30);
      // Unrelated fields preserved
      expect(doc.frontmatter.description).toBe("A sample agent");
      // Body has trailing newline from template literal
      expect(doc.body).toBe("System prompt body here.\n");
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------------
  // Model: inherit via selectModel
  // -----------------------------------------------------------------------

  it("selectModel inherit removes model from frontmatter", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      ui.enqueueSelect("my-agent (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      ui.enqueueSelect("Edit model");
      ui.enqueueSelectModel({ kind: "inherit" });
      ui.enqueueSelect("Save");
      ui.enqueueConfirm(true);

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      const result = await runAgentConfigWorkflow(undefined, deps);
      expect(result.saved).toBe(true);

      const written = fs.readFileSync(result.path!, "utf-8");
      const doc = parseAgentDocument(written);
      expect(doc.frontmatter).not.toHaveProperty("model");
      expect(doc.frontmatter.thinking).toBe("high");
      expect(doc.frontmatter.max_turns).toBe(20);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------------
  // Model: selectModel is called with correct options
  // -----------------------------------------------------------------------

  it("model edit calls selectModel with enabled, all, and current", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      ui.enqueueSelect("my-agent (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      ui.enqueueSelect("Edit model");
      ui.enqueueSelectModel(undefined); // cancel model edit
      ui.enqueueSelect("Cancel");

      const deps = makeDeps(ui, {
        cwd,
        configDir: dir,
        allModels: [
          { provider: "anthropic", id: "claude-sonnet-4-20250514" },
          { provider: "anthropic", id: "claude-opus-4-8" },
          { provider: "openai", id: "gpt-5" },
        ],
        enabledModelPatterns: ["anthropic/*"],
        builtinSources: [],
      });
      await runAgentConfigWorkflow(undefined, deps);

      const modelSelectCall = ui.calls.find((c) => c.kind === "selectModel");
      expect(modelSelectCall).toBeDefined();
      const opts = (modelSelectCall as any).options as ModelSelectorOptions;

      // enabled should contain anthropic models (from pattern)
      expect(opts.enabled).toHaveLength(2);
      expect(opts.enabled.map((m: ModelDescriptor) => `${m.provider}/${m.id}`)).toEqual([
        "anthropic/claude-opus-4-8",
        "anthropic/claude-sonnet-4-20250514",
      ]);

      // all should contain all 3 models
      expect(opts.all).toHaveLength(3);
      const allIds = opts.all.map((m: ModelDescriptor) => `${m.provider}/${m.id}`);
      expect(allIds).toContain("anthropic/claude-sonnet-4-20250514");
      expect(allIds).toContain("anthropic/claude-opus-4-8");
      expect(allIds).toContain("openai/gpt-5");

      // current should be the parsed model from the file
      expect(opts.current).toBe("anthropic/claude-sonnet-4-20250514");

      // No generic select calls for model editing
      const modelSelectCalls = ui.callsOf("select").filter((c) => c.title === "Edit model");
      expect(modelSelectCalls).toHaveLength(0);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("selectModel enabled and all have no duplicates", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      ui.enqueueSelect("my-agent (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      ui.enqueueSelect("Edit model");
      ui.enqueueSelectModel(undefined);
      ui.enqueueSelect("Cancel");

      const deps = makeDeps(ui, {
        cwd,
        configDir: dir,
        allModels: [
          { provider: "anthropic", id: "claude-sonnet" },
          { provider: "anthropic", id: "claude-sonnet" }, // duplicate
        ],
        enabledModelPatterns: ["anthropic/*"],
        builtinSources: [],
      });
      await runAgentConfigWorkflow(undefined, deps);

      const modelSelectCall = ui.calls.find((c) => c.kind === "selectModel");
      const opts = (modelSelectCall as any).options as ModelSelectorOptions;

      // No duplicates in enabled
      const enabledIds = opts.enabled.map((m: ModelDescriptor) => `${m.provider}/${m.id}`);
      expect(enabledIds).toEqual(["anthropic/claude-sonnet"]);

      // No duplicates in all
      const allIds = opts.all.map((m: ModelDescriptor) => `${m.provider}/${m.id}`);
      expect(allIds).toEqual(["anthropic/claude-sonnet"]);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------------
  // Model: direct selection via selectModel (including non-enabled)
  // -----------------------------------------------------------------------

  it("selectModel direct selection sets model", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      ui.enqueueSelect("my-agent (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      ui.enqueueSelect("Edit model");
      ui.enqueueSelectModel({ kind: "model", value: "openai/gpt-5" });
      ui.enqueueSelect("Save");
      ui.enqueueConfirm(true);

      const deps = makeDeps(ui, {
        cwd,
        configDir: dir,
        allModels: [
          { provider: "anthropic", id: "claude-sonnet-4-20250514" },
          { provider: "openai", id: "gpt-5" },
        ],
        enabledModelPatterns: ["anthropic/*"],
        builtinSources: [],
      });
      const result = await runAgentConfigWorkflow(undefined, deps);
      expect(result.saved).toBe(true);

      const written = fs.readFileSync(result.path!, "utf-8");
      const doc = parseAgentDocument(written);
      expect(doc.frontmatter.model).toBe("openai/gpt-5");
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("selectModel returns undefined cancels without mutation", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      ui.enqueueSelect("my-agent (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      ui.enqueueSelect("Edit model");
      ui.enqueueSelectModel(undefined); // cancel
      ui.enqueueSelect("Save");
      ui.enqueueConfirm(true);

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      const result = await runAgentConfigWorkflow(undefined, deps);
      expect(result.saved).toBe(true);

      // No change - file should be same as original
      const written = fs.readFileSync(result.path!, "utf-8");
      expect(written).toBe(sampleAgentContent);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------------
  // Model: manual input via selectModel
  // -----------------------------------------------------------------------

  it("selectModel returns manual prompts for valid input", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      ui.enqueueSelect("my-agent (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      ui.enqueueSelect("Edit model");
      ui.enqueueSelectModel({ kind: "manual" });
      ui.enqueueInput("custom/model-id");
      ui.enqueueSelect("Save");
      ui.enqueueConfirm(true);

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      const result = await runAgentConfigWorkflow(undefined, deps);
      expect(result.saved).toBe(true);

      const written = fs.readFileSync(result.path!, "utf-8");
      const doc = parseAgentDocument(written);
      expect(doc.frontmatter.model).toBe("custom/model-id");
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("model manual input rejects empty and retries", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      ui.enqueueSelect("my-agent (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      ui.enqueueSelect("Edit model");
      ui.enqueueSelectModel({ kind: "manual" });
      ui.enqueueInput("   "); // empty after trim
      ui.enqueueConfirm(true); // Try again
      ui.enqueueInput("valid-model");
      ui.enqueueSelect("Save");
      ui.enqueueConfirm(true);

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      const result = await runAgentConfigWorkflow(undefined, deps);
      expect(result.saved).toBe(true);

      const errorNotify = ui.calls.find((c) => c.kind === "notify" && (c as any).level === "error");
      expect(errorNotify).toBeDefined();
      expect((errorNotify as any).message).toMatch(/model/i);

      const written = fs.readFileSync(result.path!, "utf-8");
      const doc = parseAgentDocument(written);
      expect(doc.frontmatter.model).toBe("valid-model");
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("model manual input gives up after second failure", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      ui.enqueueSelect("my-agent (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      ui.enqueueSelect("Edit model");
      ui.enqueueSelectModel({ kind: "manual" });
      ui.enqueueInput(""); // first failure
      ui.enqueueConfirm(false); // decline retry
      // Back to dashboard, cancel
      ui.enqueueSelect("Cancel");

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      const result = await runAgentConfigWorkflow(undefined, deps);
      expect(result.saved).toBe(false);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("model manual input cancellation on first prompt", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      ui.enqueueSelect("my-agent (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      ui.enqueueSelect("Edit model");
      ui.enqueueSelectModel({ kind: "manual" });
      ui.enqueueInput(undefined); // cancel
      ui.enqueueSelect("Cancel");

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      const result = await runAgentConfigWorkflow(undefined, deps);
      expect(result.saved).toBe(false);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------------
  // Thinking: inherit and every explicit level
  // -----------------------------------------------------------------------

  it("thinking inherit removes thinking from frontmatter", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      ui.enqueueSelect("my-agent (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      ui.enqueueSelect("Edit thinking");
      ui.enqueueSelect("Inherit (use default)");
      ui.enqueueSelect("Save");
      ui.enqueueConfirm(true);

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      const result = await runAgentConfigWorkflow(undefined, deps);
      expect(result.saved).toBe(true);

      const written = fs.readFileSync(result.path!, "utf-8");
      const doc = parseAgentDocument(written);
      expect(doc.frontmatter).not.toHaveProperty("thinking");
      expect(doc.frontmatter.model).toBe("anthropic/claude-sonnet-4-20250514");
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  // Test each thinking level
  const thinkingLevels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
  for (const level of thinkingLevels) {
    it(`thinking can be set to "${level}"`, async () => {
      const ui = new FakeUi();
      const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
      try {
        ui.enqueueSelect("my-agent (project .pi/agents)");
        ui.enqueueSelect("Project (.pi/agents)");
        ui.enqueueSelect("Edit thinking");
        ui.enqueueSelect(level);
        ui.enqueueSelect("Save");
        ui.enqueueConfirm(true);

        const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
        const result = await runAgentConfigWorkflow(undefined, deps);
        expect(result.saved).toBe(true);

        const written = fs.readFileSync(result.path!, "utf-8");
        const doc = parseAgentDocument(written);
        expect(doc.frontmatter.thinking).toBe(level);
      } finally {
        await fsp.rm(dir, { recursive: true, force: true });
      }
    });
  }

  it("thinking menu shows all levels and inherit", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      ui.enqueueSelect("my-agent (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      ui.enqueueSelect("Edit thinking");
      ui.enqueueSelect(undefined); // cancel
      ui.enqueueSelect("Cancel");

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      await runAgentConfigWorkflow(undefined, deps);

      const thinkingCall = ui.calls.find((c) => c.kind === "select" && c.title === "Edit thinking level");
      expect(thinkingCall).toBeDefined();
      const options: string[] = (thinkingCall as any).options;
      expect(options).toContain("Inherit (use default)");
      expect(options).toContain("off");
      expect(options).toContain("minimal");
      expect(options).toContain("low");
      expect(options).toContain("medium");
      expect(options).toContain("high");
      expect(options).toContain("xhigh");
      expect(options).toContain("max");
      expect(options.length).toBe(8);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------------
  // Max turns: inherit
  // -----------------------------------------------------------------------

  it("max turns inherit removes max_turns from frontmatter", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      ui.enqueueSelect("my-agent (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      ui.enqueueSelect("Edit max turns");
      ui.enqueueSelect("Inherit (use default)");
      ui.enqueueSelect("Save");
      ui.enqueueConfirm(true);

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      const result = await runAgentConfigWorkflow(undefined, deps);
      expect(result.saved).toBe(true);

      const written = fs.readFileSync(result.path!, "utf-8");
      const doc = parseAgentDocument(written);
      expect(doc.frontmatter).not.toHaveProperty("max_turns");
      expect(doc.frontmatter.model).toBe("anthropic/claude-sonnet-4-20250514");
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------------
  // Max turns: positive integer
  // -----------------------------------------------------------------------

  it("max turns accepts positive integer", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      ui.enqueueSelect("my-agent (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      ui.enqueueSelect("Edit max turns");
      ui.enqueueSelect("Enter value...");
      ui.enqueueInput("42");
      ui.enqueueSelect("Save");
      ui.enqueueConfirm(true);

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      const result = await runAgentConfigWorkflow(undefined, deps);
      expect(result.saved).toBe(true);

      const written = fs.readFileSync(result.path!, "utf-8");
      const doc = parseAgentDocument(written);
      expect(doc.frontmatter.max_turns).toBe(42);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------------
  // Max turns: invalid input (zero, negative, text)
  // -----------------------------------------------------------------------

  it("max turns rejects zero with retry", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      ui.enqueueSelect("my-agent (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      ui.enqueueSelect("Edit max turns");
      ui.enqueueSelect("Enter value...");
      ui.enqueueInput("0"); // invalid
      ui.enqueueConfirm(true); // retry
      ui.enqueueInput("5"); // valid
      ui.enqueueSelect("Save");
      ui.enqueueConfirm(true);

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      const result = await runAgentConfigWorkflow(undefined, deps);
      expect(result.saved).toBe(true);

      const errorNotify = ui.calls.find((c) => c.kind === "notify" && (c as any).level === "error");
      expect(errorNotify).toBeDefined();

      const written = fs.readFileSync(result.path!, "utf-8");
      const doc = parseAgentDocument(written);
      expect(doc.frontmatter.max_turns).toBe(5);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("max turns rejects negative with retry", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      ui.enqueueSelect("my-agent (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      ui.enqueueSelect("Edit max turns");
      ui.enqueueSelect("Enter value...");
      ui.enqueueInput("-1");
      ui.enqueueConfirm(true); // retry
      ui.enqueueInput("1");
      ui.enqueueSelect("Save");
      ui.enqueueConfirm(true);

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      const result = await runAgentConfigWorkflow(undefined, deps);
      expect(result.saved).toBe(true);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("max turns rejects non-numeric text with retry", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      ui.enqueueSelect("my-agent (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      ui.enqueueSelect("Edit max turns");
      ui.enqueueSelect("Enter value...");
      ui.enqueueInput("abc");
      ui.enqueueConfirm(true); // retry
      ui.enqueueInput("10");
      ui.enqueueSelect("Save");
      ui.enqueueConfirm(true);

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      const result = await runAgentConfigWorkflow(undefined, deps);
      expect(result.saved).toBe(true);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("max turns cancel on invalid input", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      ui.enqueueSelect("my-agent (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      ui.enqueueSelect("Edit max turns");
      ui.enqueueSelect("Enter value...");
      ui.enqueueInput("invalid");
      ui.enqueueConfirm(false); // don't retry
      ui.enqueueSelect("Cancel");

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      const result = await runAgentConfigWorkflow(undefined, deps);
      expect(result.saved).toBe(false);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("max turns cancel on input prompt", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      ui.enqueueSelect("my-agent (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      ui.enqueueSelect("Edit max turns");
      ui.enqueueSelect("Enter value...");
      ui.enqueueInput(undefined); // cancel input
      ui.enqueueSelect("Cancel");

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      const result = await runAgentConfigWorkflow(undefined, deps);
      expect(result.saved).toBe(false);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------------
  // Before-after summary and confirm
  // -----------------------------------------------------------------------

  it("shows before-after summary on save confirmation", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      ui.enqueueSelect("my-agent (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      ui.enqueueSelect("Edit model");
      ui.enqueueSelectModel({ kind: "model", value: "openai/gpt-5" });
      ui.enqueueSelect("Save");
      ui.enqueueConfirm(true);

      const deps = makeDeps(ui, {
        cwd,
        configDir: dir,
        allModels: [
          { provider: "anthropic", id: "claude-sonnet-4-20250514" },
          { provider: "openai", id: "gpt-5" },
        ],
        enabledModelPatterns: ["anthropic/*"],
        builtinSources: [],
      });
      await runAgentConfigWorkflow(undefined, deps);

      const confirmCall = ui.calls.find((c) => c.kind === "confirm" && c.title === "Save changes?");
      expect(confirmCall).toBeDefined();
      const message = (confirmCall as any).message as string;
      expect(message).toContain("anthropic/claude-sonnet-4-20250514");
      expect(message).toContain("openai/gpt-5");
      expect(message).toContain("high");
      expect(message).toContain("20");
      expect(message).toContain("Target:");
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("cancels save when confirmation declined", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      ui.enqueueSelect("my-agent (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      ui.enqueueSelect("Edit model");
      ui.enqueueSelectModel({ kind: "model", value: "openai/gpt-5" });
      ui.enqueueSelect("Save");
      ui.enqueueConfirm(false); // decline

      const deps = makeDeps(ui, {
        cwd,
        configDir: dir,
        allModels: [
          { provider: "anthropic", id: "claude-sonnet-4-20250514" },
          { provider: "openai", id: "gpt-5" },
        ],
        enabledModelPatterns: [],
        builtinSources: [],
      });
      const result = await runAgentConfigWorkflow(undefined, deps);
      expect(result.saved).toBe(false);
      expect(result.reloadRequired).toBe(false);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------------
  // Cancellation at dashboard
  // -----------------------------------------------------------------------

  it("cancels at dashboard with Cancel option", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      ui.enqueueSelect("my-agent (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      ui.enqueueSelect("Cancel");

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      const result = await runAgentConfigWorkflow(undefined, deps);
      expect(result.saved).toBe(false);
      expect(result.reloadRequired).toBe(false);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("cancels at dashboard with undefined (escape)", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      ui.enqueueSelect("my-agent (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      ui.enqueueSelect(undefined); // escape

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      const result = await runAgentConfigWorkflow(undefined, deps);
      expect(result.saved).toBe(false);
      expect(result.reloadRequired).toBe(false);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------------
  // Cancellation at model edit level
  // -----------------------------------------------------------------------

  it("cancels at model edit and returns to dashboard", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      ui.enqueueSelect("my-agent (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      ui.enqueueSelect("Edit model");
      ui.enqueueSelectModel(undefined); // cancel at model edit
      ui.enqueueSelect("Save"); // save without changes
      ui.enqueueConfirm(true);

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      const result = await runAgentConfigWorkflow(undefined, deps);
      expect(result.saved).toBe(true);
      // No changes, so file should be same as original
      const written = fs.readFileSync(result.path!, "utf-8");
      expect(written).toBe(sampleAgentContent);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------------
  // Write failure
  // -----------------------------------------------------------------------

  it("notifies error on write failure", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      // Make the .pi/agents directory read-only to cause write failure
      const agentsDir = path.join(dir, ".pi", "agents");
      await fsp.chmod(agentsDir, 0o555); // read + execute only

      ui.enqueueSelect("my-agent (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      ui.enqueueSelect("Edit model");
      ui.enqueueSelectModel({ kind: "model", value: "openai/gpt-5" });
      ui.enqueueSelect("Save");
      ui.enqueueConfirm(true);

      const deps = makeDeps(ui, {
        cwd,
        configDir: dir,
        allModels: [
          { provider: "anthropic", id: "claude-sonnet-4-20250514" },
          { provider: "openai", id: "gpt-5" },
        ],
        enabledModelPatterns: [],
        builtinSources: [],
      });
      const result = await runAgentConfigWorkflow(undefined, deps);
      expect(result.saved).toBe(false);
      expect(result.reloadRequired).toBe(false);

      const errorNotify = ui.calls.find((c) => c.kind === "notify" && (c as any).level === "error");
      expect(errorNotify).toBeDefined();
      expect((errorNotify as any).message).toMatch(/save/i);
    } finally {
      // Restore permissions so cleanup works
      const agentsDir = path.join(dir, ".pi", "agents");
      try { await fsp.chmod(agentsDir, 0o755); } catch {}
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------------
  // Successful save: reload result
  // -----------------------------------------------------------------------

  it("returns saved=true, reloadRequired=true, path on success", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      ui.enqueueSelect("my-agent (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      ui.enqueueSelect("Edit model");
      ui.enqueueSelectModel({ kind: "model", value: "openai/gpt-5" });
      ui.enqueueSelect("Save");
      ui.enqueueConfirm(true);

      const deps = makeDeps(ui, {
        cwd,
        configDir: dir,
        allModels: [
          { provider: "anthropic", id: "claude-sonnet-4-20250514" },
          { provider: "openai", id: "gpt-5" },
        ],
        enabledModelPatterns: [],
        builtinSources: [],
      });
      const result = await runAgentConfigWorkflow(undefined, deps);
      expect(result.saved).toBe(true);
      expect(result.reloadRequired).toBe(true);
      expect(result.path).toBeDefined();
      expect(result.path).toContain("my-agent.md");

      const successNotify = ui.calls.find((c) => c.kind === "notify" && (c as any).level === "info");
      expect(successNotify).toBeDefined();
      expect((successNotify as any).message).toContain("Saved");
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------------
  // Assert supported-only mutations (no body/unrelated destruction)
  // -----------------------------------------------------------------------

  it("preserves body and unrelated frontmatter fields exactly", async () => {
    const complexContent = `---
model: anthropic/claude-sonnet-4-20250514
thinking: high
max_turns: 20
description: Complex agent
tools: read, bash, grep
enabled: true
tags:
  - a
  - b
  - c
---
# Agent Title

This is the system prompt.

It has multiple paragraphs.
`;
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("complex", complexContent);
    try {
      ui.enqueueSelect("complex (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      ui.enqueueSelect("Edit model");
      ui.enqueueSelectModel({ kind: "inherit" });
      ui.enqueueSelect("Edit thinking");
      ui.enqueueSelect("off");
      ui.enqueueSelect("Edit max turns");
      ui.enqueueSelect("Enter value...");
      ui.enqueueInput("50");
      ui.enqueueSelect("Save");
      ui.enqueueConfirm(true);

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      const result = await runAgentConfigWorkflow(undefined, deps);
      expect(result.saved).toBe(true);

      const written = fs.readFileSync(result.path!, "utf-8");
      const doc = parseAgentDocument(written);

      // Only supported fields changed
      expect(doc.frontmatter).not.toHaveProperty("model");
      expect(doc.frontmatter.thinking).toBe("off");
      expect(doc.frontmatter.max_turns).toBe(50);

      // Unrelated fields preserved
      expect(doc.frontmatter.description).toBe("Complex agent");
      expect(doc.frontmatter.tools).toBe("read, bash, grep");
      expect(doc.frontmatter.enabled).toBe(true);
      expect(doc.frontmatter.tags).toEqual(["a", "b", "c"]);

      // Body preserved exactly (template literal body has trailing newline)
      expect(doc.body).toBe("# Agent Title\n\nThis is the system prompt.\n\nIt has multiple paragraphs.\n");
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------------
  // Existing target at chosen scope
  // -----------------------------------------------------------------------

  it("uses existing target content at chosen scope when available", async () => {
    // Create project-pi agent AND global agent
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    const { dir: globalDir, configDir } = await setupGlobalAgent(
      "my-agent",
      "---\nmodel: global-model\nthinking: low\nmax_turns: 5\n---\nGlobal body.",
    );
    try {
      // Select global scope - should use the global content
      ui.enqueueSelect("my-agent (project .pi/agents — shadows global)");
      ui.enqueueSelect("Global");
      ui.enqueueConfirm(true); // shadow warning
      // Edit model to inherit
      ui.enqueueSelect("Edit model");
      ui.enqueueSelectModel({ kind: "inherit" });
      ui.enqueueSelect("Save");
      ui.enqueueConfirm(true);

      const deps = makeDeps(ui, {
        cwd,
        configDir,
        builtinSources: [
          makeAgentSource("my-agent", "global", "---\nmodel: global-model\nthinking: low\nmax_turns: 5\n---\nGlobal body.", path.join(globalDir, "agents", "my-agent.md")),
        ],
      });
      const result = await runAgentConfigWorkflow(undefined, deps);
      expect(result.saved).toBe(true);

      // The written file should be at the global path
      expect(result.path).toContain("my-agent.md");
      const written = fs.readFileSync(result.path!, "utf-8");
      const doc = parseAgentDocument(written);
      // Model should be removed (inherit)
      expect(doc.frontmatter).not.toHaveProperty("model");
      // Thinking should still be "low" from global
      expect(doc.frontmatter.thinking).toBe("low");
      // Max turns should still be 5
      expect(doc.frontmatter.max_turns).toBe(5);
      // Body should be global body
      expect(doc.body).toBe("Global body.");
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
      await fsp.rm(globalDir, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------------
  // No-op save (no changes) still confirms
  // -----------------------------------------------------------------------

  it("allows save with no changes", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      ui.enqueueSelect("my-agent (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      ui.enqueueSelect("Save");
      ui.enqueueConfirm(true);

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      const result = await runAgentConfigWorkflow(undefined, deps);
      expect(result.saved).toBe(true);

      const written = fs.readFileSync(result.path!, "utf-8");
      expect(written).toBe(sampleAgentContent);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------------
  // Case-sensitive agent name matching
  // -----------------------------------------------------------------------

  it("matches agent name case-sensitively", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("MyAgent", sampleAgentContent);
    try {
      ui.enqueueSelect("MyAgent (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      ui.enqueueSelect("Cancel");

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      const result = await runAgentConfigWorkflow(undefined, deps);
      expect(result.saved).toBe(false);

      // Verify "myagent" (lowercase) is not found by direct arg
      const ui2 = new FakeUi();
      const deps2 = makeDeps(ui2, { cwd, configDir: dir, builtinSources: [] });
      const result2 = await runAgentConfigWorkflow("myagent", deps2);
      expect(result2.saved).toBe(false);
      const errNotify = ui2.lastCall("notify");
      expect((errNotify as any).level).toBe("error");
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  // =======================================================================
  // Gap 1: State presence semantics — dashboard must display (inherit) when
  // user explicitly selects inherit, not the stale parsed value.
  // =======================================================================

  it("dashboard displays (inherit) for model after selecting inherit", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      ui.enqueueSelect("my-agent (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      // Edit model → inherit
      ui.enqueueSelect("Edit model");
      ui.enqueueSelectModel({ kind: "inherit" });
      // Dashboard should now show (inherit) for model
      // We'll check this by looking at the dashboard display
      // Save to verify
      ui.enqueueSelect("Save");
      ui.enqueueConfirm(true);

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      const result = await runAgentConfigWorkflow(undefined, deps);
      expect(result.saved).toBe(true);

      // The dashboard call after model edit should show (inherit)
      const dashboardCalls = ui.callsOf("select").filter(
        (c) => c.title.includes("Model:") || c.title.includes("Thinking:") || c.title.includes("Max turns:"),
      );
      // The last dashboard before save should show (inherit) for model
      const lastDashboard = dashboardCalls[dashboardCalls.length - 1];
      expect(lastDashboard).toBeDefined();
      const title = lastDashboard.title;
      // Model should show (inherit) not anthropic/claude-sonnet-4-20250514
      expect(title).toContain("Model: (inherit)");
      expect(title).not.toContain("claude-sonnet");
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("after editing model then editing again, current is passed with new model", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      ui.enqueueSelect("my-agent (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      // First edit: set to openai/gpt-5
      ui.enqueueSelect("Edit model");
      ui.enqueueSelectModel({ kind: "model", value: "openai/gpt-5" });
      // Second edit: current should be openai/gpt-5
      ui.enqueueSelect("Edit model");
      ui.enqueueSelectModel(undefined); // cancel
      ui.enqueueSelect("Cancel");

      const deps = makeDeps(ui, {
        cwd,
        configDir: dir,
        allModels: [
          { provider: "anthropic", id: "claude-sonnet-4-20250514" },
          { provider: "openai", id: "gpt-5" },
        ],
        enabledModelPatterns: [],
        builtinSources: [],
      });
      await runAgentConfigWorkflow(undefined, deps);

      // Second selectModel call should have current = "openai/gpt-5"
      const selectModelCalls = ui.callsOf("selectModel");
      expect(selectModelCalls).toHaveLength(2);
      expect(selectModelCalls[1].options.current).toBe("openai/gpt-5");
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("after selecting inherit, current is passed as undefined", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      ui.enqueueSelect("my-agent (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      // First edit: inherit
      ui.enqueueSelect("Edit model");
      ui.enqueueSelectModel({ kind: "inherit" });
      // Second edit: current should be undefined
      ui.enqueueSelect("Edit model");
      ui.enqueueSelectModel(undefined); // cancel
      ui.enqueueSelect("Cancel");

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      await runAgentConfigWorkflow(undefined, deps);

      // Second selectModel call should have current = undefined
      const selectModelCalls = ui.callsOf("selectModel");
      expect(selectModelCalls).toHaveLength(2);
      expect(selectModelCalls[1].options.current).toBeUndefined();
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("dashboard displays (inherit) for thinking after selecting inherit", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      ui.enqueueSelect("my-agent (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      ui.enqueueSelect("Edit thinking");
      ui.enqueueSelect("Inherit (use default)");
      ui.enqueueSelect("Save");
      ui.enqueueConfirm(true);

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      await runAgentConfigWorkflow(undefined, deps);

      const dashboardCalls = ui.callsOf("select").filter(
        (c) => c.title.includes("Thinking:"),
      );
      const lastDashboard = dashboardCalls[dashboardCalls.length - 1];
      const title = lastDashboard.title;
      expect(title).toContain("Thinking: (inherit)");
      expect(title).not.toContain("high");
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("dashboard displays (inherit) for max turns after selecting inherit", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      ui.enqueueSelect("my-agent (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      ui.enqueueSelect("Edit max turns");
      ui.enqueueSelect("Inherit (use default)");
      ui.enqueueSelect("Save");
      ui.enqueueConfirm(true);

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      await runAgentConfigWorkflow(undefined, deps);

      const dashboardCalls = ui.callsOf("select").filter(
        (c) => c.title.includes("Max turns:"),
      );
      const lastDashboard = dashboardCalls[dashboardCalls.length - 1];
      const title = lastDashboard.title;
      expect(title).toContain("Max turns: (inherit)");
      // Assert the Max turns line specifically doesn't contain stale "20"
      const maxTurnsLine = title.split("\n").find((l: string) => l.startsWith("Max turns:"));
      expect(maxTurnsLine).toBeDefined();
      expect(maxTurnsLine).not.toContain("20");
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("dashboard displays (inherit) for all three fields after selecting inherit for each", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      ui.enqueueSelect("my-agent (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      ui.enqueueSelect("Edit model");
      ui.enqueueSelectModel({ kind: "inherit" });
      ui.enqueueSelect("Edit thinking");
      ui.enqueueSelect("Inherit (use default)");
      ui.enqueueSelect("Edit max turns");
      ui.enqueueSelect("Inherit (use default)");
      // Final dashboard should show all three as (inherit)
      ui.enqueueSelect("Save");
      ui.enqueueConfirm(true);

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      await runAgentConfigWorkflow(undefined, deps);

      const dashboardCalls = ui.callsOf("select").filter(
        (c) => c.title.includes("Model:") || c.title.includes("Max turns:"),
      );
      const lastDashboard = dashboardCalls[dashboardCalls.length - 1];
      const title = lastDashboard.title;
      expect(title).toContain("Model: (inherit)");
      expect(title).toContain("Thinking: (inherit)");
      expect(title).toContain("Max turns: (inherit)");
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("dashboard handles malformed starting values correctly when inheriting", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("malformed", malformedValuesContent);
    try {
      ui.enqueueSelect("malformed (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      // Edit model to inherit (malformed value 123)
      ui.enqueueSelect("Edit model");
      ui.enqueueSelectModel({ kind: "inherit" });
      // Dashboard should show (inherit) for model
      // Edit thinking to inherit too
      ui.enqueueSelect("Edit thinking");
      ui.enqueueSelect("Inherit (use default)");
      // Now max_turns was malformed (-5), edit to inherit
      ui.enqueueSelect("Edit max turns");
      ui.enqueueSelect("Inherit (use default)");
      ui.enqueueSelect("Save");
      ui.enqueueConfirm(true);

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      await runAgentConfigWorkflow(undefined, deps);

      const dashboardCalls = ui.callsOf("select").filter(
        (c) => c.title.includes("Model:"),
      );
      const lastDashboard = dashboardCalls[dashboardCalls.length - 1];
      const title = lastDashboard.title;
      expect(title).toContain("Model: (inherit)");
      expect(title).toContain("Thinking: (inherit)");
      expect(title).toContain("Max turns: (inherit)");
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  // =======================================================================
  // Gap 2: Accurate summary — distinguish untouched from explicit inherit
  // =======================================================================

  it("summary shows (unchanged) for untouched fields", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      ui.enqueueSelect("my-agent (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      // Only edit model, leave thinking and max_turns untouched
      ui.enqueueSelect("Edit model");
      ui.enqueueSelectModel({ kind: "model", value: "openai/gpt-5" });
      ui.enqueueSelect("Save");
      ui.enqueueConfirm(true);

      const deps = makeDeps(ui, {
        cwd,
        configDir: dir,
        allModels: [
          { provider: "anthropic", id: "claude-sonnet-4-20250514" },
          { provider: "openai", id: "gpt-5" },
        ],
        enabledModelPatterns: [],
        builtinSources: [],
      });
      await runAgentConfigWorkflow(undefined, deps);

      const confirmCall = ui.calls.find((c) => c.kind === "confirm" && c.title === "Save changes?");
      expect(confirmCall).toBeDefined();
      const message = (confirmCall as any).message as string;

      // Model was explicitly changed
      expect(message).toContain("claude-sonnet");
      expect(message).toContain("openai/gpt-5");

      // Thinking was NOT touched — should show (unchanged)
      const thinkingLine = message.split("\n").find((l: string) => l.startsWith("Thinking:"));
      expect(thinkingLine).toBeDefined();
      expect(thinkingLine).toContain("high");
      expect(thinkingLine).not.toContain("(inherit)");

      // Max turns was NOT touched — should show (unchanged)
      const maxTurnsLine = message.split("\n").find((l: string) => l.startsWith("Max turns:"));
      expect(maxTurnsLine).toBeDefined();
      expect(maxTurnsLine).toContain("20");
      expect(maxTurnsLine).not.toContain("(inherit)");
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("summary shows (inherit) only for fields explicitly set to inherit", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      ui.enqueueSelect("my-agent (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      // Edit model to inherit, leave others untouched
      ui.enqueueSelect("Edit model");
      ui.enqueueSelectModel({ kind: "inherit" });
      ui.enqueueSelect("Save");
      ui.enqueueConfirm(true);

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      await runAgentConfigWorkflow(undefined, deps);

      const confirmCall = ui.calls.find((c) => c.kind === "confirm" && c.title === "Save changes?");
      expect(confirmCall).toBeDefined();
      const message = (confirmCall as any).message as string;

      // Model: explicit inherit → (inherit)
      expect(message).toContain("claude-sonnet");
      expect(message).toContain("(inherit)");

      // Thinking: untouched → should NOT claim (inherit)
      const thinkingLine = message.split("\n").find((l: string) => l.startsWith("Thinking:"));
      expect(thinkingLine).toBeDefined();
      expect(thinkingLine).not.toContain("(inherit)");

      // Max turns: untouched → should NOT claim (inherit)
      const maxTurnsLine = message.split("\n").find((l: string) => l.startsWith("Max turns:"));
      expect(maxTurnsLine).toBeDefined();
      expect(maxTurnsLine).toContain("20");
      expect(maxTurnsLine).not.toContain("(inherit)");
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("summary shows mixed touched/untouched/inherit correctly", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      ui.enqueueSelect("my-agent (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      // Edit model to inherit
      ui.enqueueSelect("Edit model");
      ui.enqueueSelectModel({ kind: "inherit" });
      // Edit thinking to explicit value
      ui.enqueueSelect("Edit thinking");
      ui.enqueueSelect("medium");
      // Leave max_turns untouched
      ui.enqueueSelect("Save");
      ui.enqueueConfirm(true);

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      await runAgentConfigWorkflow(undefined, deps);

      const confirmCall = ui.calls.find((c) => c.kind === "confirm" && c.title === "Save changes?");
      expect(confirmCall).toBeDefined();
      const message = (confirmCall as any).message as string;

      // Model: explicit inherit
      expect(message).toContain("Model:");
      expect(message).toContain("(inherit)");

      // Thinking: explicit value change
      expect(message).toContain("Thinking:");
      expect(message).toContain("high");
      expect(message).toContain("medium");

      // Max turns: untouched — should show (unchanged), not (inherit)
      expect(message).toContain("Max turns:");
      expect(message).toContain("20");
      // Line-based assertion: must not claim it's being set to (inherit)
      const maxTurnsLine = message.split("\n").find((l: string) => l.startsWith("Max turns:"));
      expect(maxTurnsLine).toBeDefined();
      expect(maxTurnsLine).toContain("20 → (unchanged)");
      expect(maxTurnsLine).not.toContain("(inherit)");
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("resulting document honors mixed touched/untouched/inherit", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      ui.enqueueSelect("my-agent (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      // Edit model to inherit
      ui.enqueueSelect("Edit model");
      ui.enqueueSelectModel({ kind: "inherit" });
      // Edit thinking to explicit
      ui.enqueueSelect("Edit thinking");
      ui.enqueueSelect("off");
      // Leave max_turns untouched
      ui.enqueueSelect("Save");
      ui.enqueueConfirm(true);

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      const result = await runAgentConfigWorkflow(undefined, deps);
      expect(result.saved).toBe(true);

      const written = fs.readFileSync(result.path!, "utf-8");
      const doc = parseAgentDocument(written);
      // Model removed (inherit)
      expect(doc.frontmatter).not.toHaveProperty("model");
      // Thinking updated to off
      expect(doc.frontmatter.thinking).toBe("off");
      // Max turns preserved (untouched)
      expect(doc.frontmatter.max_turns).toBe(20);
      // Description preserved
      expect(doc.frontmatter.description).toBe("A sample agent");
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  // =======================================================================
  // Gap 3: Malformed document — refuse to work with unparseable content
  // =======================================================================

  it("refuses malformed YAML and notifies actionable error", async () => {
    const ui = new FakeUi();
    const malformedYamlContent = "---\nmodel: [unclosed\n---\nBody text.\n";
    const { dir, cwd } = await setupProjectWithAgent("bad", malformedYamlContent);
    try {
      ui.enqueueSelect("bad (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      const result = await runAgentConfigWorkflow(undefined, deps);
      // Must not save
      expect(result.saved).toBe(false);
      expect(result.reloadRequired).toBe(false);

      // Must have notified an actionable error
      const errorNotify = ui.calls.find((c) => c.kind === "notify" && (c as any).level === "error");
      expect(errorNotify).toBeDefined();
      const msg = (errorNotify as any).message as string;
      expect(msg).toMatch(/malformed|parse|YAML|unterminated|frontmatter|fix/i);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses unterminated frontmatter", async () => {
    const ui = new FakeUi();
    const unterminatedContent = "---\nmodel: test\nBody without closing delimiter.\n";
    const { dir, cwd } = await setupProjectWithAgent("bad", unterminatedContent);
    try {
      ui.enqueueSelect("bad (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      const result = await runAgentConfigWorkflow(undefined, deps);
      expect(result.saved).toBe(false);
      expect(result.reloadRequired).toBe(false);

      const errorNotify = ui.calls.find((c) => c.kind === "notify" && (c as any).level === "error");
      expect(errorNotify).toBeDefined();
      expect((errorNotify as any).message).toMatch(/unterminated|frontmatter|closing|fix|eject/i);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses non-mapping frontmatter (scalar)", async () => {
    const ui = new FakeUi();
    const scalarContent = "---\n42\n---\nBody.\n";
    const { dir, cwd } = await setupProjectWithAgent("bad", scalarContent);
    try {
      ui.enqueueSelect("bad (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      const result = await runAgentConfigWorkflow(undefined, deps);
      expect(result.saved).toBe(false);
      expect(result.reloadRequired).toBe(false);

      const errorNotify = ui.calls.find((c) => c.kind === "notify" && (c as any).level === "error");
      expect(errorNotify).toBeDefined();
      expect((errorNotify as any).message).toMatch(/mapping|object|parse|fix|eject/i);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses non-mapping frontmatter (array)", async () => {
    const ui = new FakeUi();
    const arrayContent = "---\n- a\n- b\n---\nBody.\n";
    const { dir, cwd } = await setupProjectWithAgent("bad", arrayContent);
    try {
      ui.enqueueSelect("bad (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      const result = await runAgentConfigWorkflow(undefined, deps);
      expect(result.saved).toBe(false);
      expect(result.reloadRequired).toBe(false);

      const errorNotify = ui.calls.find((c) => c.kind === "notify" && (c as any).level === "error");
      expect(errorNotify).toBeDefined();
      expect((errorNotify as any).message).toMatch(/mapping|object|array|parse|fix|eject/i);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("malformed document error does not throw uncaught", async () => {
    const ui = new FakeUi();
    const malformedContent = "---\nmodel: [unclosed\n---\nBody.\n";
    const { dir, cwd } = await setupProjectWithAgent("bad", malformedContent);
    try {
      ui.enqueueSelect("bad (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      // Must not throw
      const result = await runAgentConfigWorkflow(undefined, deps);
      expect(result.saved).toBe(false);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("malformed document does not write", async () => {
    const ui = new FakeUi();
    const malformedContent = "---\nmodel: [unclosed\n---\nBody.\n";
    const { dir, cwd } = await setupProjectWithAgent("bad", malformedContent);
    try {
      ui.enqueueSelect("bad (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      await runAgentConfigWorkflow(undefined, deps);

      // Original file must be unchanged
      const written = fs.readFileSync(path.join(dir, ".pi", "agents", "bad.md"), "utf-8");
      expect(written).toBe(malformedContent);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  // =======================================================================
  // Gap 4: Validate requestedAgent with validateAgentName before lookup
  // =======================================================================

  it("rejects requestedAgent with NUL character", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      const result = await runAgentConfigWorkflow("bad\x00name", deps);
      expect(result.saved).toBe(false);
      expect(result.reloadRequired).toBe(false);

      const errorNotify = ui.calls.find((c) => c.kind === "notify" && (c as any).level === "error");
      expect(errorNotify).toBeDefined();
      expect((errorNotify as any).message).toMatch(/name|invalid|NUL/i);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects requestedAgent with traversal sequence", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      const result = await runAgentConfigWorkflow("../escape", deps);
      expect(result.saved).toBe(false);
      expect(result.reloadRequired).toBe(false);

      const errorNotify = ui.calls.find((c) => c.kind === "notify" && (c as any).level === "error");
      expect(errorNotify).toBeDefined();
      expect((errorNotify as any).message).toMatch(/name|invalid|traversal/i);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects requestedAgent with forward slash", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      const result = await runAgentConfigWorkflow("foo/bar", deps);
      expect(result.saved).toBe(false);
      expect(result.reloadRequired).toBe(false);

      const errorNotify = ui.calls.find((c) => c.kind === "notify" && (c as any).level === "error");
      expect(errorNotify).toBeDefined();
      expect((errorNotify as any).message).toMatch(/name|invalid|separator/i);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects requestedAgent that is '..'", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      const result = await runAgentConfigWorkflow("..", deps);
      expect(result.saved).toBe(false);
      expect(result.reloadRequired).toBe(false);

      const errorNotify = ui.calls.find((c) => c.kind === "notify" && (c as any).level === "error");
      expect(errorNotify).toBeDefined();
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  // =======================================================================
  // Gap 5: Manual model input — replace one-retry with confirm loop
  // =======================================================================

  it("manual model input loops until valid with Try again? confirm", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      ui.enqueueSelect("my-agent (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      ui.enqueueSelect("Edit model");
      ui.enqueueSelectModel({ kind: "manual" });
      // First: empty
      ui.enqueueInput("   ");
      ui.enqueueConfirm(true); // Try again
      // Second: control chars
      ui.enqueueInput("bad\x00model");
      ui.enqueueConfirm(true); // Try again
      // Third: line breaks
      ui.enqueueInput("a\nb");
      ui.enqueueConfirm(true); // Try again
      // Fourth: valid
      ui.enqueueInput("valid-model");
      ui.enqueueSelect("Save");
      ui.enqueueConfirm(true);

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      const result = await runAgentConfigWorkflow(undefined, deps);
      expect(result.saved).toBe(true);

      const written = fs.readFileSync(result.path!, "utf-8");
      const doc = parseAgentDocument(written);
      expect(doc.frontmatter.model).toBe("valid-model");
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("manual model input declines Try again? and returns to dashboard", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      ui.enqueueSelect("my-agent (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      ui.enqueueSelect("Edit model");
      ui.enqueueSelectModel({ kind: "manual" });
      ui.enqueueInput("   "); // invalid
      ui.enqueueConfirm(false); // Decline retry
      // Back to dashboard, cancel
      ui.enqueueSelect("Cancel");

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      const result = await runAgentConfigWorkflow(undefined, deps);
      expect(result.saved).toBe(false);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("manual model input cancel on first prompt returns to dashboard", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      ui.enqueueSelect("my-agent (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      ui.enqueueSelect("Edit model");
      ui.enqueueSelectModel({ kind: "manual" });
      ui.enqueueInput(undefined); // cancel
      ui.enqueueSelect("Cancel");

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      const result = await runAgentConfigWorkflow(undefined, deps);
      expect(result.saved).toBe(false);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  // =======================================================================
  // Gap 6: Empty target file must be respected, not replaced by effective
  // =======================================================================

  it("respects empty target file content at chosen scope", async () => {
    const ui = new FakeUi();
    const emptyContent = "";
    const { dir, cwd } = await setupProjectWithAgent("empty-agent", emptyContent);
    try {
      ui.enqueueSelect("empty-agent (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      // Edit model to add a value
      ui.enqueueSelect("Edit model");
      ui.enqueueSelectModel({ kind: "model", value: "anthropic/claude-sonnet-4-20250514" });
      ui.enqueueSelect("Save");
      ui.enqueueConfirm(true);

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      const result = await runAgentConfigWorkflow(undefined, deps);
      expect(result.saved).toBe(true);

      const written = fs.readFileSync(result.path!, "utf-8");
      const doc = parseAgentDocument(written);
      expect(doc.frontmatter.model).toBe("anthropic/claude-sonnet-4-20250514");
      // Body should be empty (empty original file, no frontmatter)
      expect(doc.body).toBe("");
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("empty target file at scope is used even when effective has content", async () => {
    // Create a global agent with content, project with empty file
    const ui = new FakeUi();
    const dir = tmpdir();
    const globalDir = tmpdir();
    const cwd = dir;
    try {
      // Project agent with empty content
      const agentsDir = path.join(dir, ".pi", "agents");
      await fsp.mkdir(agentsDir, { recursive: true });
      await fsp.writeFile(path.join(agentsDir, "agent.md"), "", "utf-8");

      // Global agent with content (in separate directory)
      const globalAgentsDir = path.join(globalDir, "agents");
      await fsp.mkdir(globalAgentsDir, { recursive: true });
      await fsp.writeFile(path.join(globalAgentsDir, "agent.md"), "---\nmodel: global-model\n---\nGlobal body.", "utf-8");

      ui.enqueueSelect("agent (project .pi/agents — shadows global)");
      ui.enqueueSelect("Project (.pi/agents)");
      ui.enqueueConfirm(true); // shadow warning
      // Edit model
      ui.enqueueSelect("Edit model");
      ui.enqueueSelectModel({ kind: "model", value: "anthropic/claude-sonnet-4-20250514" });
      ui.enqueueSelect("Save");
      ui.enqueueConfirm(true);

      const deps = makeDeps(ui, {
        cwd,
        configDir: globalDir,
        builtinSources: [
          makeAgentSource("agent", "global", "---\nmodel: global-model\n---\nGlobal body.", path.join(globalAgentsDir, "agent.md")),
        ],
      });
      const result = await runAgentConfigWorkflow(undefined, deps);
      expect(result.saved).toBe(true);

      const written = fs.readFileSync(result.path!, "utf-8");
      const doc = parseAgentDocument(written);
      // Should have model from edit, body from empty file (not global body)
      expect(doc.frontmatter.model).toBe("anthropic/claude-sonnet-4-20250514");
      expect(doc.body).toBe("");
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
      await fsp.rm(globalDir, { recursive: true, force: true });
    }
  });

  // =======================================================================
  // Gap 7: Nested editor cancellation returns to dashboard (accepted)
  // =======================================================================

  it("cancelling at model edit menu returns to dashboard (accepted behavior)", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      ui.enqueueSelect("my-agent (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      // Edit model then cancel
      ui.enqueueSelect("Edit model");
      ui.enqueueSelectModel(undefined); // cancel at model menu
      // Dashboard appears again
      ui.enqueueSelect("Cancel");

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      const result = await runAgentConfigWorkflow(undefined, deps);
      expect(result.saved).toBe(false);

      // Verify dashboard was shown twice (initial + after cancel)
      const dashboardCalls = ui.calls.filter(
        (c) => c.kind === "select" && c.title.includes("Model:"),
      );
      expect(dashboardCalls.length).toBeGreaterThanOrEqual(2);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("cancelling at thinking edit menu returns to dashboard (accepted behavior)", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      ui.enqueueSelect("my-agent (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      ui.enqueueSelect("Edit thinking");
      ui.enqueueSelect(undefined); // cancel
      ui.enqueueSelect("Cancel");

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      const result = await runAgentConfigWorkflow(undefined, deps);
      expect(result.saved).toBe(false);

      // Dashboard was shown twice
      const dashboardCalls = ui.calls.filter(
        (c) => c.kind === "select" && c.title.includes("Model:"),
      );
      expect(dashboardCalls.length).toBeGreaterThanOrEqual(2);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it("cancelling at max turns menu returns to dashboard (accepted behavior)", async () => {
    const ui = new FakeUi();
    const { dir, cwd } = await setupProjectWithAgent("my-agent", sampleAgentContent);
    try {
      ui.enqueueSelect("my-agent (project .pi/agents)");
      ui.enqueueSelect("Project (.pi/agents)");
      ui.enqueueSelect("Edit max turns");
      ui.enqueueSelect(undefined); // cancel
      ui.enqueueSelect("Cancel");

      const deps = makeDeps(ui, { cwd, configDir: dir, builtinSources: [] });
      const result = await runAgentConfigWorkflow(undefined, deps);
      expect(result.saved).toBe(false);

      const dashboardCalls = ui.calls.filter(
        (c) => c.kind === "select" && c.title.includes("Model:"),
      );
      expect(dashboardCalls.length).toBeGreaterThanOrEqual(2);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});