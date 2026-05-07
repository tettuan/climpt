---
stepId: closure.clarify.scan-iterator-failure
name: Scan Latest Iterator-Failure Comment
description: Read-only scan for the iterator-failure anchored comment.
uvVariables:
  - issue
---

# Goal: Recover iterator failure context from issue #{uv-issue}

This step does NOT decide a verdict. It only extracts failure evidence
that the rubric step (`clarify`) will consume so the 2nd-pass rubric
can differ from the 1st pass.

## Inputs (handoff)

- `{uv-issue}` — GitHub issue number (entry-step UV; no upstream
  handoff fields).

## Outputs

Schema: `closure.clarify.scan-iterator-failure` in
`schemas/clarifier.schema.json`.

- `iterator_failure_context: object | null` — Parsed payload from the
  most recent comment on issue #{uv-issue} whose first line is the
  anchor `<!-- iterator-failure-v1 -->`. Null when no such comment
  exists (first clarify on this issue, or iterator has never failed
  on this issue).

The parsed object mirrors iterator's `iterator_last_failure`:

- `pattern: string` — failurePatterns key (e.g. `ac-evidence-missing`,
  `kind-boundary-breach`, `test-failed`, or `unspecified`).
- `evidence_summary: string` — 1-3 sentences describing the failure.
- `missing_acs: string[]` (optional) — ac_id list when relevant.
- `kind_boundary: { violations: [{path, reason}, ...] }` (optional).

## Action

1. Run exactly:

   ```bash
   gh issue view {uv-issue} --json comments
   ```

2. From `comments[]`, locate the **most recent** entry whose `body`
   starts with the anchor `<!-- iterator-failure-v1 -->` (newest
   `createdAt` wins).

3. If no such comment exists → emit
   `iterator_failure_context: null` and `next_action.action: "handoff"`.

4. If the comment exists, parse the body:
   - The body is rendered from `commentTemplates.iteratorFailed`
     (`workflow.json`) using `{iterator_last_failure}` placeholder. The
     value is JSON-stringified (handoff layer JSON-serializes
     non-string handoff variables).
   - Strip the anchor line and the `## Iterator: failed` heading.
   - Locate the JSON block (it appears verbatim where the
     `{iterator_last_failure}` placeholder was rendered) and parse it.
   - Populate `iterator_failure_context.{pattern, evidence_summary,
     missing_acs?, kind_boundary?}` from the parsed JSON.
   - If JSON parse fails → emit
     `iterator_failure_context: null` and a `summary` noting the parse
     failure. Do NOT repeat — the rubric step will treat null as
     "no prior failure" (1st-pass behavior).

## Verdict

- `handoff` — extraction completed (including null result). Transitions
  to the closure step `clarify`. Per StepKind boundary rules,
  work→closure transitions use the `handoff` intent (not `next`).
- `repeat` — `gh issue view` parse / network failure. Re-runs this
  step. Schema parse failure does NOT trigger repeat (we degrade
  gracefully to null, see Action 4).

## Do ONLY this

- Do not run any command other than the single `gh issue view --json
  comments` call.
- Do not call `Read` / `Glob` / `Grep` against the repository.
- Do not post any comment.
- Do not edit labels or close the issue.
