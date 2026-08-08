import assert from "node:assert/strict";
import test from "node:test";
import { createCouncilModelGateway } from "../extensions/council/model-gateway.js";
import { filterModelIds } from "../extensions/council/model-picker.js";

test("filterModelIds matches case-insensitively and caps large catalogues", () => {
  const modelIds = Array.from({ length: 80 }, (_, index) => `openrouter/vendor/model-${index}`);
  modelIds.push("openrouter/Anthropic/Claude-Sonnet");

  assert.deepEqual(filterModelIds(modelIds, "anthropic"), ["openrouter/Anthropic/Claude-Sonnet"]);
  assert.equal(filterModelIds(modelIds, "model-").length, 50);
  assert.deepEqual(filterModelIds(modelIds, "   "), []);
});

test("Council gateway resolves nested model ids through ModelRegistry", () => {
  const calls: unknown[][] = [];
  const expectedModel = { provider: "openrouter", id: "google/gemini-test", reasoning: true };
  const registry = {
    find(provider: string, id: string) {
      calls.push(["find", provider, id]);
      return expectedModel;
    },
  };

  const gateway = createCouncilModelGateway(registry as any);
  assert.equal(gateway.resolve("openrouter/google/gemini-test"), expectedModel);
  assert.deepEqual(calls, [["find", "openrouter", "google/gemini-test"]]);
});

test("Council gateway forwards context, cancellation, and reasoning options", async () => {
  const calls: unknown[][] = [];
  const response = { role: "assistant", content: [], usage: { cost: { total: 0 } } };
  const registry = {
    find() {
      return undefined;
    },
    async complete(...args: unknown[]) {
      calls.push(args);
      return response;
    },
  };
  const gateway = createCouncilModelGateway(registry as any);
  const model = { provider: "openrouter", id: "reasoning-model", reasoning: true } as any;
  const context = { messages: [] } as any;
  const signal = new AbortController().signal;

  assert.equal(await gateway.complete(model, context, signal), response);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], model);
  assert.equal(calls[0][1], context);
  assert.deepEqual(calls[0][2], { signal, reasoningEffort: "medium" });
});
