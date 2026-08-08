# Spec Compliance Reviewer Task Brief

Use this as the complete `task` value for a fresh `reviewer` child launched through `runs.run(...)`.

**Purpose:** determine whether the implementation matches the approved task—nothing required missing and no unapproved behavior added.

## Inputs to Include

- Full original task and acceptance criteria
- Relevant approved design and plan sections
- Exact base/head commits or changed-file scope
- Implementer report and verification evidence

## Independent Verification

Do not trust the implementer report. Read the actual diff and relevant surrounding code. Compare implementation to requirements item by item.

Check for:

- missing behavior, files, tests, or documentation;
- claims not supported by code or command evidence;
- extra features, scope expansion, or unnecessary abstractions;
- incorrect interpretations of the requirement;
- changes outside the assigned ownership boundary.

Do not turn this into a general style review; quality review happens only after specification compliance passes.

## Report Format

Return exactly one verdict:

- `SPEC_COMPLIANT` with brief supporting evidence; or
- `SPEC_ISSUES` followed by a concrete list of missing, extra, or misunderstood behavior with `file:line` references.

A concern without repository evidence is not a blocking finding.
