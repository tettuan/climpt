---
stepId: closure.detail.compose-and-post
name: Compose Implementation Spec And Post Comment
description: Single-iteration closure - compose 5-section spec, post one comment, emit verdict.
uvVariables:
  - issue
---

# Task: Compose and post Implementation Spec for issue #{uv-issue}

> **CRITICAL: DO NOT RUN ISSUE STATE COMMANDS**
>
> You MUST NOT execute these commands directly:
>
> - `gh issue close` — BLOCKED
> - `gh issue edit --add-label` / `--remove-label` — BLOCKED
> - `gh api` for issue state mutation — BLOCKED
>
> The Boundary Hook will apply label transitions when you return `closing`
> intent. Issue #{uv-issue} stays **OPEN** for the next agent (iterator at
> `impl-pending`).

## Inputs (handoff)

- `considerer_comment_body` — from `closure.detail.scan-considerer`. May be
  `null` (forces `verdict: "blocked"`).
- `issue_acceptance_criteria` — from `closure.detail.scan-considerer`. Empty
  array allowed.
- `iterator_failure_context` — from `closure.detail.scan-considerer`. May
  be `null`. When non-null, this is the differentiating signal from the
  1st-pass spec; the spec MUST address `pattern` directly (e.g.
  `ac-evidence-missing` → tighten Acceptance Criteria with concrete
  `evidence_paths`; `kind-boundary-breach` → narrow Changes section to
  the kind:* boundary; `test-failed` / `type-error` → name the failing
  symbol/file in Changes + Test Plan). Never re-emit a byte-identical
  spec on the 2nd pass — that is the iterator-grind anti-pattern.
- `anchor_verification_results: [{anchor, kind, exists}]` — from
  `closure.detail.verify-anchors`.
- `missing_anchors: string[]` — from `closure.detail.verify-anchors`.
  Non-empty triggers `verdict: "blocked"` (Verdict rule M).
- `{uv-issue}` — GitHub issue number.

## Outputs

Schema: `closure.detail.compose-and-post` in `schemas/detailer.schema.json`.

```json
{
  "stepId": "closure.detail.compose-and-post",
  "status": "completed",
  "summary": "<one-line summary of what was specified>",
  "next_action": { "action": "closing" },
  "verdict": "handoff-impl",
  "closure_action": "label-only",
  "issue": { "labels": { "add": [], "remove": [] } },
  "final_summary": "<one-paragraph recap incl. verdict rationale>",
  "detail_summary": "<one-paragraph recap of the spec — iterator handoff>",
  "spec_comment_url": "<URL of the posted comment>",
  "blocked_reason": null,
  "considerer_comment_body": "<echo>",
  "issue_acceptance_criteria": ["<echo>"],
  "iterator_failure_context": null,
  "anchor_verification_results": ["<echo>"],
  "missing_anchors": []
}
```

Output rules:

- `verdict` MUST be `"handoff-impl"` or `"blocked"`. Decision rules in `## Verdict`.
- `next_action.action` is always `"closing"` (single-iteration closure).
- `closure_action` is always `"label-only"` (orchestrator owns label/phase).
- `issue.labels` MUST be `{ "add": [], "remove": [] }` (empty).
- For `verdict: "handoff-impl"`, `spec_comment_url` MUST be a non-empty string
  and `blocked_reason` MUST be `null`.
- For `verdict: "blocked"`, `blocked_reason` MUST be a non-empty string.
- Always echo `considerer_comment_body`, `issue_acceptance_criteria`,
  `iterator_failure_context`, `anchor_verification_results`,
  `missing_anchors` from upstream so audit logs preserve the evidence
  basis for the verdict.

## Action

### Step 1 — Decide verdict from upstream evidence

Apply `## Verdict` rules in order. The first matching rule wins.

### Step 2 — Compose the spec body

Write to `$TMPDIR/detailer-{uv-issue}.md`. Match the issue language
(Japanese issue → Japanese spec).

For `verdict: "handoff-impl"` use this exact 5-section structure:

```markdown
## Implementation Spec

### Summary
<1-2 lines naming what is built>

### Changes
- **Files**: <verified path>, <verified path>
- **Functions / Lines**: <symbol at file.ts:L10-L40>, <ClassName.method>

### Approach
<specific implementation strategy referencing existing patterns>

### Acceptance Criteria
- [ ] <observable outcome 1>
- [ ] <observable outcome 2>

### Test Plan
- <test viewpoint: unit/integration/e2e + named target>
```

For `verdict: "blocked"` use:

```markdown
## Implementation Spec

### Blocked
<1-3 sentences naming what is missing and what would resolve it>
```

### Step 3 — Post exactly one comment

```bash
gh issue comment {uv-issue} --body-file "$TMPDIR/detailer-{uv-issue}.md"
```

Capture the returned comment URL into `spec_comment_url`.

### Step 4 — Emit structured output

Emit the JSON object described in `## Outputs`. Include the upstream
echo fields verbatim.

### Step 5 — Final status line

```
detailer: <verdict> #{uv-issue} (<short reason>)
```

## Verdict

Decide `verdict ∈ { "handoff-impl", "blocked" }` by applying the rules
below in order. The first matching rule wins.

### Rule N — No considerer comment (highest priority)

If `considerer_comment_body` is `null`, emit `verdict: "blocked"` with
`blocked_reason = "No considerer comment beginning with '## 検討結果' was found on issue #{uv-issue}."`

### Rule M — Missing anchors override

If `missing_anchors` is non-empty, emit `verdict: "blocked"` with
`blocked_reason = "Cited anchors not found in repository: <comma-separated missing_anchors>"`.
The considerer comment references files / symbols that do not exist; the
spec cannot be grounded.

### Rule H — Handoff handoff-impl

Emit `verdict: "handoff-impl"` only when **all** hold:

1. `considerer_comment_body` is non-null.
2. `missing_anchors` is empty (every cited anchor exists).
3. All five sections of the Implementation Spec template can be filled
   with concrete, non-placeholder content from the considerer comment +
   verified anchors + `issue_acceptance_criteria`.

### Rule B — Blocked fallback

Otherwise emit `verdict: "blocked"` with a `blocked_reason` naming the
specific missing element (acceptance criteria absent, approach
unspecifiable, etc.).

## Do ONLY this

- Post exactly one comment to issue #{uv-issue} via
  `gh issue comment ... --body-file`.
- Emit exactly one structured output matching `closure.detail.compose-and-post`.
- Do NOT run `gh issue close` (orchestrator owns the close).
- Do NOT run `gh issue edit --add-label` / `--remove-label` (orchestrator
  owns label reconciliation via workflow.json labelMapping).
- Do NOT call `Edit` / `Write` / `NotebookEdit` against repository code.
- Do NOT re-run anchor verification — trust the upstream
  `anchor_verification_results` / `missing_anchors`.
- Do NOT emit intents other than `closing`.
