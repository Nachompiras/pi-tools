import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
	DEFAULT_CONFIG,
	isFleetRole,
	mergeConfig,
	parseModelRef,
	resolveRoleModels,
} from "../failover-config.js";
import {
	countSwitchableErrors,
	decideFailover,
	effectiveRetryAfter,
	parseRetryAfter,
} from "../failover-decision.js";

test("parseModelRef splits on first slash, id keeps remaining slashes", () => {
	assert.deepEqual(parseModelRef("openrouter/deepseek/deepseek-v4-flash-0731"), {
		provider: "openrouter",
		id: "deepseek/deepseek-v4-flash-0731",
	});
	assert.deepEqual(parseModelRef("anthropic/claude-opus-4-8"), { provider: "anthropic", id: "claude-opus-4-8" });
	assert.equal(parseModelRef("noslash"), null);
	assert.equal(parseModelRef("/leading"), null);
	assert.equal(parseModelRef("trailing/"), null);
});

test("isFleetRole validates known roles", () => {
	assert.equal(isFleetRole("worker"), true);
	assert.equal(isFleetRole("test-worker"), true);
	assert.equal(isFleetRole("nonsense"), false);
	assert.equal(isFleetRole(undefined), false);
});

test("mergeConfig overlays user config and drops malformed roles", () => {
	const cfg = mergeConfig({
		roles: {
			worker: { primary: "p/w", backup: "p/b", thinking: "low" },
			bogus: { primary: "x/y" }, // unknown role dropped
			reviewer: { backup: "only-backup" }, // no primary → dropped, default kept
		},
		onProviderError: { autoSwitch: true, retryAfterSeconds: 30, statusCodes: [429], minErrorsToOffer: 1 },
	});
	assert.deepEqual(cfg.roles.worker, { primary: "p/w", backup: "p/b", thinking: "low" });
	assert.equal((cfg.roles as Record<string, unknown>).bogus, undefined);
	// reviewer kept its shipped default because the override had no primary
	assert.equal(cfg.roles.reviewer?.primary, DEFAULT_CONFIG.roles.reviewer?.primary);
	assert.equal(cfg.onProviderError.autoSwitch, true);
	assert.equal(cfg.onProviderError.retryAfterSeconds, 30);
	assert.deepEqual(cfg.onProviderError.statusCodes, [429]);
	assert.equal(cfg.onProviderError.minErrorsToOffer, 1);
});

test("mergeConfig on garbage returns shipped defaults", () => {
	assert.deepEqual(mergeConfig(null), { roles: { ...DEFAULT_CONFIG.roles }, onProviderError: { ...DEFAULT_CONFIG.onProviderError }, watchdogSeconds: DEFAULT_CONFIG.watchdogSeconds });
	assert.deepEqual(mergeConfig("nope").roles.worker, DEFAULT_CONFIG.roles.worker);
});

test("parseRetryAfter reads delta-seconds, ignores non-numeric", () => {
	assert.equal(parseRetryAfter({ "retry-after": "42" }), 42);
	assert.equal(parseRetryAfter({ "Retry-After": "10" }), 10);
	assert.equal(parseRetryAfter({ "retry-after": "Wed, 21 Oct 2099 07:28:00 GMT" }), undefined);
	assert.equal(parseRetryAfter({}), undefined);
});

test("countSwitchableErrors and effectiveRetryAfter", () => {
	const errs = [
		{ status: 429, retryAfterSeconds: 20 },
		{ status: 500 },
		{ status: 429, retryAfterSeconds: 90 },
	];
	assert.equal(countSwitchableErrors(errs, [429, 503]), 2);
	assert.equal(effectiveRetryAfter(errs, [429], 60), 90); // max header wins
	assert.equal(effectiveRetryAfter([{ status: 429 }], [429], 60), 60); // fallback when no header
});

const policy = DEFAULT_CONFIG.onProviderError; // minErrorsToOffer=2, autoSwitch=false, [429,503]

test("decideFailover: below threshold → none", () => {
	const a = decideFailover({
		role: "worker",
		roleModels: DEFAULT_CONFIG.roles.worker,
		currentModelRef: DEFAULT_CONFIG.roles.worker!.primary,
		errors: [{ status: 429 }],
		policy,
	});
	assert.equal(a.kind, "none");
});

test("decideFailover: worker primary erroring → offer switch to backup", () => {
	const a = decideFailover({
		role: "worker",
		roleModels: DEFAULT_CONFIG.roles.worker,
		currentModelRef: DEFAULT_CONFIG.roles.worker!.primary,
		errors: [{ status: 429, retryAfterSeconds: 15 }, { status: 429 }],
		policy,
	});
	assert.equal(a.kind, "offer-switch");
	if (a.kind === "offer-switch") {
		assert.equal(a.to, DEFAULT_CONFIG.roles.worker!.backup);
		assert.equal(a.retryAfterSeconds, 15);
	}
});

test("decideFailover: autoSwitch policy → auto-switch", () => {
	const a = decideFailover({
		role: "reviewer",
		roleModels: DEFAULT_CONFIG.roles.reviewer,
		currentModelRef: DEFAULT_CONFIG.roles.reviewer!.primary,
		errors: [{ status: 429 }, { status: 429 }],
		policy: { ...policy, autoSwitch: true },
	});
	assert.equal(a.kind, "auto-switch");
	if (a.kind === "auto-switch") assert.equal(a.to, "anthropic/claude-opus-4-8");
});

test("decideFailover: already on backup → suggest retry, no ping-pong", () => {
	const a = decideFailover({
		role: "worker",
		roleModels: DEFAULT_CONFIG.roles.worker,
		currentModelRef: DEFAULT_CONFIG.roles.worker!.backup!,
		errors: [{ status: 429 }, { status: 429 }],
		policy,
	});
	assert.equal(a.kind, "suggest-retry");
});

test("decideFailover: no backup configured → suggest retry", () => {
	const a = decideFailover({
		role: "master",
		roleModels: DEFAULT_CONFIG.roles.master, // master has no backup
		currentModelRef: DEFAULT_CONFIG.roles.master!.primary,
		errors: [{ status: 503 }, { status: 503 }],
		policy,
	});
	assert.equal(a.kind, "suggest-retry");
});

test("decideFailover: no role/config → suggest retry with reason", () => {
	const a = decideFailover({
		role: undefined,
		roleModels: undefined,
		currentModelRef: "some/model",
		errors: [{ status: 429 }, { status: 429 }],
		policy,
	});
	assert.equal(a.kind, "suggest-retry");
	if (a.kind === "suggest-retry") assert.ok(a.reason.includes("config"));
});

test("resolveRoleModels returns undefined for no role", () => {
	assert.equal(resolveRoleModels(DEFAULT_CONFIG, undefined), undefined);
	assert.deepEqual(resolveRoleModels(DEFAULT_CONFIG, "worker"), DEFAULT_CONFIG.roles.worker);
});
