---
stepId: closure.clarify.scan-prior-verdicts
name: Scan Prior Clarifier-Verdict Comments
description: Read-only scan for prior `<!-- clarifier-verdict-v1 -->` comments to build the anchor-signature ledger consumed by Gate 3 progress predicate.
uvVariables:
  - issue
---

# Goal: Build the prior-verdict signature ledger for issue #{uv-issue}

This step does NOT decide a verdict. It extracts mechanical evidence that the
rubric step (`clarify`) consumes so Gate 3 can enforce the **progress
predicate** (CLAUDE.md 全域性 + Core-first): the same anchor signature MUST NOT
pass `ready-to-impl` twice with an iterator failure in between.

## Inputs (handoff)

- `{uv-issue}` — GitHub issue number (uvVariable, required).
- Upstream handoff from `closure.clarify.scan-iterator-failure`:
  `iterator_failure_context: object | null` — passes through, not consumed here.

## Outputs

Schema: `closure.clarify.scan-prior-verdicts` in
`schemas/clarifier.schema.json`.

- `prior_anchor_signatures: Array<{ created_at, anchor_signature, verdict }>` —
  chronological (ascending by `created_at`) ledger of prior clarifier verdicts.
  Each element is parsed from a comment whose first line is exactly
  `<!-- clarifier-verdict-v1 -->`. Empty array when no prior v1-anchored verdict
  exists. Comments without the v1 anchor are ignored (no backward-compat; pre-v1
  comments are unparseable).
- `iterator_failure_timestamps: string[]` — chronological (ascending) ISO 8601
  timestamps for every comment whose first line is
  `<!-- iterator-failure-v1 -->`. Used by Gate 3 to detect "iterator failed
  AFTER my last `ready-to-impl`".

## Action

1. Run exactly:

   ```bash
   gh issue view {uv-issue} --json comments
   ```

   (Same call shape as `scan-iterator-failure`; orchestrator does not provide a
   shared cache, so this step issues its own request.)

2. From `comments[]`, in chronological order (ascending `createdAt`):

   - For every comment whose `body` first line is exactly
     `<!-- clarifier-verdict-v1 -->`:
     - Extract `created_at` from the comment's `createdAt` field (ISO 8601
       string).
     - Extract `anchor_signature` from the line matching the regex
       `^<!-- anchor-signature: ([a-f0-9]{64}) -->$` (must be the second line of
       the body for v1 comments). If the line is missing, malformed, or fails
       the 64-hex pattern → set to `null`.
     - Extract `verdict` from the first `## Clarifier verdict:
       <verdict>`
       line. Trim whitespace; accept exactly `ready-to-impl` or
       `ready-to-consider`. If neither is present, skip the entry (do not emit a
       malformed row).
   - For every comment whose `body` first line is exactly
     `<!-- iterator-failure-v1 -->`:
     - Append the comment's `createdAt` to `iterator_failure_timestamps`.

3. Sort `prior_anchor_signatures` ascending by `created_at`. Sort
   `iterator_failure_timestamps` ascending.

4. Emit `next_action.action: "handoff"` always (including empty ledgers). The
   clarifier rubric step treats empty arrays as "1st-pass — Gate 3 progress
   predicate vacuously holds".

## Verdict

- `handoff` — extraction completed (including empty result). Transitions to the
  closure step `clarify`. Per StepKind boundary rules, work→closure transitions
  use the `handoff` intent.
- `repeat` — `gh issue view` network failure (timeout, rate limit, 403). Re-runs
  this step. Schema parse failure of an individual comment does NOT trigger
  repeat — that comment is silently skipped per Action Step 2.

## Do ONLY this

- Do not run any command other than the single `gh issue view --json
  comments`
  call.
- Do not call `Read` / `Glob` / `Grep` against the repository.
- Do not post any comment.
- Do not edit labels or close the issue.
- Do not parse comments lacking the v1 anchor as the first line — the v1 marker
  is the source of truth; pre-v1 / un-anchored comments are out of scope.
