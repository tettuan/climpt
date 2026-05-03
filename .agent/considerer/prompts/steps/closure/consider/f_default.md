---
stepId: consider
name: Consider Implementation Request
description: Single-iteration — read, research, respond, emit verdict, close.
uvVariables:
  - issue
---

# Task: Consider issue #{uv-issue}

## Inputs (handoff)

- `{uv-issue}` — GitHub issue number.
- `doc_paths_required` — doc paths the issue references (regex: `docs/**`,
  `agents/docs/**`), from `closure.consider.doc-scan`.
- `doc_diff_results: [{path, diffed}]` — whether each path was last modified
  after the issue's `createdAt`, from `closure.consider.doc-verify`.
- `doc_evidence: [{path, diffed, commits: [{sha, date, subject, stat}], truncated}]` —
  commit metadata since baseline for `diffed=true` paths, from
  `closure.consider.doc-evidence`. No diff body — drill in with
  `git show <sha> -- <path>` if you need hunks.
- `kind_at_triage` — audit-only artifact from
  `closure.consider.precheck-kind-read`. Do NOT gate the verdict on it; the
  orchestrator routes by current label. A `kind_at_triage` / current label
  drift is resolved by trusting the current label (this dispatch).
- `kind_boundary_violations: [{path, reason}]` — paths violating considerer's
  source-edit boundary, from `closure.consider.precheck-kind-scope`. Empty =
  clean.

## Outputs

Return a JSON object matching `closure.consider` in
`schemas/considerer.schema.json`:

```json
{
  "stepId": "consider",
  "status": "completed",
  "summary": "<one-line summary of what was answered>",
  "next_action": { "action": "closing" },
  "verdict": "done",
  "final_summary": "<one-paragraph recap incl. verdict rationale>",
  "handoff_anchor": {
    "file": null,
    "symbol": null,
    "strategy": null
  },
  "doc_paths_required": <pass through from upstream>,
  "doc_diff_results": <pass through from upstream>,
  "doc_evidence": <pass through from upstream>
}
```

Output rules:

- `verdict` MUST be `"done"` or `"handoff-detail"` (decision rules in `## Verdict`).
- For `verdict: "handoff-detail"`, at least one of `handoff_anchor.file`,
  `handoff_anchor.symbol`, `handoff_anchor.strategy` MUST be a non-empty string.
  All three may be filled. When the trigger is a `diffed=false` path (Verdict
  rule D2), use that path as `handoff_anchor.file`.
- For `verdict: "done"`, `handoff_anchor` fields MAY all be `null`.
- `next_action.action` is always `"closing"` (single-iteration closure).
- Always echo `doc_paths_required`, `doc_diff_results`, `doc_evidence` from the
  upstream handoff so audit logs preserve the evidence basis for the verdict.

## Action

### Step 1 — Read the issue

```bash
gh issue view {uv-issue} --json number,title,body,labels,author,comments
```

Parse:

- The question(s) in the body (sections `## 質問`, `## 回答期待`, etc.)
- Any embedded implementation request (`## 実装要望`)
- Prior comments

### Step 2 — Research

Investigate the question using read-only tools. Cite evidence.

- Use `Grep` / `Glob` / `Read` on the codebase for behavioral questions.
- Use `Read` on `docs/` and `.agent/**/README.md` for design/policy questions.
- Delegate deep investigation to a sub-agent via `Task` if the scope is broad.
- Use `WebFetch` only when the issue references an external URL.

### Step 3 — Compose response

Follow the response comment structure in the system prompt exactly. Required
sections:

- `### 質問への回答`
- `### 実装要望の評価`
- `### 次アクション`

Write in Japanese to match the issue language. Cite file paths with `path:line`
format.

### Step 4 — Decide verdict

See `## Verdict` for the decision rules. Record the chosen anchor (file /
symbol / strategy) inside `### 次アクション` of the response comment so
reviewers can audit the call. When the trigger is doc evidence, cite the
resolving commit's `sha` + `subject` (or the `diffed=false` path) in
`### 次アクション`.

### Step 5 — Post response

Considerer's responsibility ends at posting the response. The orchestrator
performs the phase transition (including label add/remove) from your verdict
inside a TransactionScope saga, so you must **not** touch labels or issue state
yourself.

**Do NOT run:**

- `gh issue close` (orchestrator closes on `done` verdict)
- `gh issue edit --add-label` / `--remove-label` (orchestrator reconciles labels
  based on verdict; self-swapping here diverges the saga's view and leaves the
  issue in an inconsistent state if the transition fails)

Execute:

```bash
# Post the response — this is the only mutation you perform.
gh issue comment {uv-issue} --body-file <path-to-your-response>
```

Write the response to a scratch file under `$TMPDIR/considerer-{uv-issue}.md`
first, then pass it to `--body-file`. Do not embed multi-line markdown in a
shell argument.

### Step 6 — Emit structured output

Emit the JSON object described in `## Outputs`.

### Step 7 — Final status

Output a single-line summary:

```
considerer: <verdict> #<N> (awaiting orchestrator label/phase transition)
```

On failure at any step, stop and report which step failed with the full command
output. Do not retry silently. Do NOT attempt `gh issue close` or any label
mutation.

## Verdict

The terminal `consider` step always emits `next_action.action: "closing"`.
Decide `verdict ∈ { "done", "handoff-detail" }` by applying the rules below
in order. The first matching rule wins.

### Rule B — Boundary breach override (highest priority)

If `kind_boundary_violations` is non-empty, considerer accidentally edited
source files outside `tests/`. Emit `verdict: "handoff-detail"`. Set
`handoff_anchor.strategy` to
`"Boundary breach: <count> path(s) violate considerer scope — manual review required"`.
List the violations verbatim in `### 次アクション`.

### Rule D — Doc evidence MUST rule (when `doc_paths_required` non-empty)

- D1. `doc_paths_required` empty → skip Rule D; fall through to Rule S.
- D2. Any path has `diffed=false` → emit `verdict: "handoff-detail"` with
  that path recorded in `handoff_anchor.file`. The doc work is unfinished;
  do not emit `done`.
- D3. All `diffed=true` AND the commit metadata in `doc_evidence` plausibly
  addresses the issue's stated requirement (subject lines reference this
  issue, or `--stat` is consistent with the requested change) → `done`.
  Cite the resolving commit's `sha` + `subject` in `### 次アクション`.
- D4. All `diffed=true` BUT commit metadata does not address this issue
  (subjects clearly belong to a different issue, or the changes are too
  small/large to plausibly resolve the requirement) → drill in with
  `git show <sha> -- <path>` to confirm. If still not resolving →
  `verdict: "handoff-detail"`, anchor to the path. If genuinely resolving
  despite the surface signals → `done` (cite the hunks).

Rule D overrides the abstract-only fallback in Rule S: when
`doc_paths_required` is non-empty, you may NOT short-circuit to `done` purely
because no concrete anchor surfaced — the path itself is the anchor.

### Rule S — Standard criteria (when no boundary breach and Rule D yields no decision)

Emit `handoff-detail` only when **both** hold:

1. You conclude that implementation **should** be done.
2. You can name **at least one** concrete anchor:
   - target file path (e.g., `agents/orchestrator/dispatcher.ts`)
   - function / type / symbol (e.g., `mapResultToOutcome`)
   - modification strategy (specific approach, not "refactor" or "improve")

Otherwise emit `done`. This includes:

- Question fully answered, no implementation needed.
- Not a bug / expected behavior / won't-fix / infeasible / duplicate.
- Implementation-recommended but only abstractly — close here rather than
  forwarding an under-specified request to the detailer.

## Do ONLY this

- Post exactly one comment to issue #{uv-issue} via `gh issue comment ... --body-file`.
- Emit exactly one structured output matching `closure.consider`.
- Do NOT run `gh issue close` (orchestrator owns the close).
- Do NOT run `gh issue edit --add-label` / `--remove-label` (orchestrator owns label reconciliation).
- Do NOT touch `kind_at_triage`; it is audit-only and does not gate the verdict.
- Do NOT emit intents other than `closing`.
