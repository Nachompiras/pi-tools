import { describe, expect, it } from "vitest";
import {
  THINKING_LEVELS,
  isValidThinkingLevel,
  type ThinkingLevel,
  type AgentScope,
  type EditableAgentConfig,
} from "../src/types.js";

describe("thinking levels", () => {
  it("exports the seven thinking levels in UI order", () => {
    expect(THINKING_LEVELS).toEqual([
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ] satisfies ThinkingLevel[]);
  });

  it("validates known thinking levels", () => {
    for (const level of THINKING_LEVELS) {
      expect(isValidThinkingLevel(level)).toBe(true);
    }
  });

  it("rejects unknown thinking levels", () => {
    expect(isValidThinkingLevel("unknown")).toBe(false);
    expect(isValidThinkingLevel("")).toBe(false);
    expect(isValidThinkingLevel("OFF")).toBe(false);
    expect(isValidThinkingLevel("Medium")).toBe(false);
  });
});

describe("EditableAgentConfig", () => {
  it("accepts optional fields", () => {
    const config: EditableAgentConfig = {};
    expect(config.model).toBeUndefined();
    expect(config.thinking).toBeUndefined();
    expect(config.maxTurns).toBeUndefined();
  });

  it("accepts fully populated config", () => {
    const config: EditableAgentConfig = {
      model: "anthropic/claude-sonnet-4-20250514",
      thinking: "high",
      maxTurns: 20,
    };
    expect(config.model).toBe("anthropic/claude-sonnet-4-20250514");
    expect(config.thinking).toBe("high");
    expect(config.maxTurns).toBe(20);
  });
});
