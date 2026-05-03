---
stepId: closure.detail.scan-considerer
name: Scan Issue Body, Considerer And Iterator-Failure Comments
description: Read-only scan of issue body, considerer comment, and iterator-failure comment.
uvVariables:
  - issue
---

# Goal: Read issue #{uv-issue} body and the latest considerer / iterator-failure comments

This step does NOT decide a verdict, does NOT verify anchors, and does NOT
post any comment. It only extracts the raw textual evidence the downstream
steps need.

## Inputs (handoff)

- `{uv-issue}` — GitHub issue number (entry-step UV; no upstream handoff fields).

## Outputs

Schema: `closure.detail.scan-considerer` in `schemas/detailer.schema.json`.

- `considerer_comment_body: string | null` — full markdown body of the latest
  considerer comment. Null only if no comment beginning with `## 検討結果`
  exists.
- `issue_acceptance_criteria: string[]` — bullet items / checkbox items from
  the issue body that state acceptance criteria, expected behavior, or
  requirements. Empty array when none are present.
- `iterator_failure_context: object | null` — Parsed payload from the most
  recent comment whose first line is `<!-- iterator-failure-v1 -->`. Null
  when no such comment exists or parsing fails. Mirrors iterator's
  `iterator_last_failure` shape: `{pattern, evidence_summary, missing_acs?,
  kind_boundary?}`. Used by `closure.detail.compose-and-post` so the 2nd-pass
  spec differs from the 1st pass.

## Action

1. Run exactly:

   ```bash
   gh issue view {uv-issue} --json number,title,body,labels,author,comments
   ```

2. From `comments[]`, locate the latest entry whose `body` begins with
   `## 検討結果` (newest by `createdAt`). Capture its full `body` verbatim
   into `considerer_comment_body`. If no such comment exists, set
   `considerer_comment_body` to `null`.

3. From `comments[]`, locate the latest entry whose `body` first line is
   the anchor `<!-- iterator-failure-v1 -->` (newest `createdAt`).
   - If found: parse the body. The anchored comment is rendered from
     `commentTemplates.iteratorFailed` (`workflow.json`) using the
     `{iterator_last_failure}` placeholder — the JSON payload appears
     verbatim where the placeholder was rendered. Parse it into
     `iterator_failure_context.{pattern, evidence_summary, missing_acs?,
     kind_boundary?}`.
   - If parsing fails or no such comment exists: set
     `iterator_failure_context` to `null`. Do NOT repeat — null is the
     "no prior failure" signal for downstream.

4. From the issue `body`, extract acceptance-criteria-style lines:
   - Markdown checkbox items under `## Acceptance Criteria`,
     `## 受入条件`, `## 期待動作`, `## 完了条件`, or equivalent headings.
   - If no dedicated section exists, capture top-level bullet items that
     describe expected outcomes verbatim.
   - Trim each item; do not paraphrase. Preserve original order.
   - Emit `[]` (empty array) if none can be extracted.

## Verdict

- `next` — extraction completed (including any null fields). Transitions to
  `closure.detail.verify-anchors`.
- `repeat` — `gh issue view` parse / network failure. Re-runs this step.
  Iterator-failure JSON parse failure does NOT trigger repeat (degrade to
  null).

## Do ONLY this

- Do not run any command other than the single `gh issue view --json …` call
  in Action step 1.
- Do not call `Read` / `Glob` / `Grep` against the repository — anchor
  verification is the next step's responsibility.
- Do not post any comment.
- Do not emit `verdict`, `final_summary`, `spec_comment_url`, or any
  other artifact field beyond the three declared outputs.
