---
name: writing-plans
description: Use when you have a spec or requirements for a multi-step task, before touching code
---

# Writing Plans

## Overview

Write implementation plans as a **TODO list of well-defined tasks**, not as pre-written code. Document what each task must achieve, the contracts/interfaces it touches, the behavior to verify, and the references the engineer should consult. The engineer writes the actual code following TDD — you define the targets, not the keystrokes.

Document for each task: which files to touch, the interfaces/contracts involved, the behavior and acceptance criteria, docs they might need to check, and how to test it. Give them the whole plan as bite-sized tasks. DRY. YAGNI. TDD. Frequent commits.

Assume they are a competent developer who will write the implementation themselves. They know almost nothing about our toolset, problem domain, or where things live — so be explicit about paths, contracts, and expected behavior. But do **not** spell out function bodies or full test files for them: define the contract and the behavior, and let them implement it test-first.

**The default is to describe, not to pre-write code.** Write literal code only when that code *is* the definition (see "When to Show Code" below).

**Announce at start:** "I'm using the writing-plans skill to create the implementation plan."

**Context:** This should be run in a dedicated worktree (created by brainstorming skill).

**Save plans to:** `docs/superpowers/plans/YYYY-MM-DD-<feature-name>.md`
- (User preferences for plan location override this default)

## Scope Check

If the spec covers multiple independent subsystems, it should have been broken into sub-project specs during brainstorming. If it wasn't, suggest breaking this into separate plans — one per subsystem. Each plan should produce working, testable software on its own.

## File Structure

Before defining tasks, map out which files will be created or modified and what each one is responsible for. This is where decomposition decisions get locked in.

- Design units with clear boundaries and well-defined interfaces. Each file should have one clear responsibility.
- You reason best about code you can hold in context at once, and your edits are more reliable when files are focused. Prefer smaller, focused files over large ones that do too much.
- Files that change together should live together. Split by responsibility, not by technical layer.
- In existing codebases, follow established patterns. If the codebase uses large files, don't unilaterally restructure - but if a file you're modifying has grown unwieldy, including a split in the plan is reasonable.

This structure informs the task decomposition. Each task should produce self-contained changes that make sense independently.

## When to Show Code

The plan describes behavior and defines contracts. It does **not** contain the implementation. Use this rule to decide whether a code block belongs in the plan:

**Show literal code only when the code IS the definition** — i.e. it's a contract the engineer must match exactly:
- Function/method **signatures** (name, params, return type) — but not their bodies
- Type/struct/interface/enum definitions, schemas, API request/response shapes
- Config keys, constants, or enum values that other code depends on
- Exact shell commands to run
- Commit messages

**Describe instead of showing code** for everything the engineer implements:
- Function bodies / algorithm steps → describe the behavior and edge cases in prose
- Tests → describe what to assert (Given/When/Then or a bullet list of cases), don't write the test file
- Wiring/glue code → describe what connects to what

The litmus test: *"Is this code something the engineer must reproduce verbatim, or something they should write themselves?"* Only the former goes in the plan.

## Bite-Sized Task Granularity

**Each step is one action (2-5 minutes), phrased as an instruction — not as pre-written code:**
- "Write a failing test for [specific behavior]" - step (describe the cases, don't write the test)
- "Run it to make sure it fails" - step
- "Implement [function] to satisfy the test" - step (reference the contract, don't write the body)
- "Run the tests and make sure they pass" - step
- "Commit" - step

## Plan Document Header

**Every plan MUST start with this header:**

```markdown
# [Feature Name] Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** [One sentence describing what this builds]

**Architecture:** [2-3 sentences about approach]

**Tech Stack:** [Key technologies/libraries]

---
```

## Task Structure

Each task defines a target: the files, the contract, the behavior to verify, and acceptance criteria. The engineer fills in the code test-first.

````markdown
### Task N: [Component Name]

**Files:**
- Create: `exact/path/to/file.py`
- Modify: `exact/path/to/existing.py:123-145`
- Test: `tests/exact/path/to/test.py`

**Contract** (the signature/types the engineer must match — this IS the definition):

```python
def compute_discount(cart: Cart, coupon: Coupon | None) -> Money: ...
```

**References:** [existing patterns to follow, e.g. `src/pricing/tax.py` for the Money usage; relevant docs]

- [ ] **Step 1: Write the failing test**

Test `compute_discount` covers:
- No coupon → returns zero discount
- Percentage coupon → applies percent to cart subtotal
- Coupon above cart total → discount capped at subtotal (never negative)
- Expired coupon → raises `CouponExpired`

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/path/test.py::test_name -v`
Expected: FAIL with "function not defined"

- [ ] **Step 3: Implement `compute_discount` to satisfy the test**

Apply the coupon to the cart subtotal per the cases above. Cap the result at the subtotal; raise `CouponExpired` for expired coupons. Reuse `Money` arithmetic from `src/pricing/tax.py`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/path/test.py::test_name -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/path/test.py src/path/file.py
git commit -m "feat: add discount computation"
```
````

Note how only the **signature** and the **commands** are literal code. The test cases and the implementation are *described*, because the engineer writes those test-first.

## Write in Parts — Never All at Once

**Never write the entire plan in a single response.** Long responses cause connection timeouts and lose all work.

**Required approach:**
1. **Start:** Announce the skill, do scope check, define file structure — save to file immediately with a `# WIP` marker at the top
2. **Per task:** Write one task at a time, append it to the file, confirm saved before continuing to the next
3. **Finish:** Remove the `# WIP` marker, run self-review, save final version

**Between each task, write the task directly to the file using a tool call (write/edit) — do not buffer tasks in memory.** If the connection drops mid-plan, the file will have whatever was written so far and work can resume.

## No Vague Placeholders

Describing behavior is good. Being *vague* is the failure. The difference: a good description names the concrete cases and outcomes; a placeholder gestures at work without specifying it.

These are **plan failures** — never write them:
- "TBD", "TODO: implement later", "fill in details"
- "Add appropriate error handling" → instead: name *which* errors and what happens ("raise `CouponExpired` for expired coupons; reject negative quantities with `ValueError`")
- "Handle edge cases" → instead: list the actual edge cases
- "Write tests for the above" → instead: list the specific cases to assert
- "Similar to Task N" → instead: name the behavior explicitly (the engineer may read tasks out of order). You may *reference* a contract defined elsewhere, but restate the behavior.
- References to types/functions/methods whose contract is never defined in any task

**Allowed (and encouraged):** describing what a function does and what its tests assert, in prose, instead of writing the code. That is not a placeholder — it's the point.

## Remember
- Exact file paths always
- Define contracts (signatures, types, schemas) as literal code; describe behavior and tests in prose
- The engineer writes the implementation and the tests test-first — the plan is the target, not the code
- Exact commands with expected output
- DRY, YAGNI, TDD, frequent commits

## Self-Review

After writing the complete plan, look at the spec with fresh eyes and check the plan against it. This is a checklist you run yourself — not a subagent dispatch.

**1. Spec coverage:** Skim each section/requirement in the spec. Can you point to a task that implements it? List any gaps.

**2. Placeholder scan:** Search your plan for red flags — any of the patterns from the "No Vague Placeholders" section above. Also check the reverse: are you pre-writing implementation code or full test files that the engineer should write themselves? If so, replace it with a contract + behavior description (see "When to Show Code"). Fix both directions.

**3. Type consistency:** Do the types, method signatures, and property names you used in later tasks match what you defined in earlier tasks? A function called `clearLayers()` in Task 3 but `clearFullLayers()` in Task 7 is a bug.

If you find issues, fix them inline. No need to re-review — just fix and move on. If you find a spec requirement with no task, add the task.

## Execution Handoff

After saving the plan, offer execution choice:

**"Plan complete and saved to `docs/superpowers/plans/<filename>.md`. Three execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration (in-process subagents, one session)

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**3. Agent Fleet (Herdr/ORCA)** - Multiple long-lived agent sessions in parallel across isolated git worktrees: architect/worker/reviewer pods + a shared Test Pod. For large plans that decompose into independent workstreams and outlive one context window.

**Which approach?"**

**If Subagent-Driven chosen:**
- **REQUIRED SUB-SKILL:** Use superpowers:subagent-driven-development
- Fresh subagent per task + two-stage review

**If Inline Execution chosen:**
- **REQUIRED SUB-SKILL:** Use superpowers:executing-plans
- Batch execution with checkpoints for review

**If Agent Fleet chosen:**
- **REQUIRED SUB-SKILL:** Use orchestrating-agent-fleets
- You become the master orchestrator: draw the dependency graph, then run the
  automated wave setup (`scripts/fleet.sh`) yourself and provision pods.
  Do NOT hand fleet.sh commands to the user — you run them.
