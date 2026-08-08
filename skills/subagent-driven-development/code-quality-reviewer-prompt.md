# Code Quality Reviewer Task Brief

Use this as the complete `task` value for a fresh `reviewer` child launched through `runs.run(...)` only after spec compliance passes.

Base the review on `skills/requesting-code-review/code-reviewer.md` and include:

- what was implemented;
- the approved task and plan path;
- exact base and head commits;
- focused and full verification evidence;
- the implementer's changed-file list.

Inspect the actual diff and surrounding code. Check correctness, error handling, security/privacy boundaries, meaningful tests, maintainability, unnecessary complexity, and relevant performance risks.

Also check that:

- each changed file has one clear responsibility;
- units can be understood and tested independently;
- the implementation follows the plan's file structure;
- new code did not make files needlessly large or tangled;
- findings distinguish newly introduced problems from pre-existing issues.

## Report Format

Return:

1. **Strengths**
2. **Issues** grouped as Critical, Important, or Minor, each with `file:line` evidence and a concrete correction
3. **Assessment:** `APPROVED` or `CHANGES_REQUIRED`

Do not approve when Critical or Important issues remain. Do not block on unsupported preferences.
