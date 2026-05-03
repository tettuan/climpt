---
stepId: clarify
name: Clarify Need-Clearance Issue
description: Single-iteration — read issue, apply 5-gate rubric, post comment, emit verdict. Orchestrator routes via outputPhases.
uvVariables:
  - issue
---

# Task: Clarify issue #{uv-issue}

You process exactly one issue (#{uv-issue}). The orchestrator has already
selected this issue from the `blocked` phase queue. Your job: apply the 5-gate
rubric, post a verdict comment, emit a verdict string.

## Inputs (handoff)

- `{uv-issue}` — GitHub Issue number (uvVariable, required). The orchestrator
  has already dispatched this agent for one specific `need clearance` issue.
- `iterator_failure_context` (handoff from
  `closure.clarify.scan-iterator-failure`) — `object | null`. When non-null, it
  carries `{pattern, evidence_summary, missing_acs?,
  kind_boundary?}` from the
  most recent iterator-failure-anchored comment. Null means either no prior
  iterator failure exists on this issue, or the failure comment could not be
  parsed. **When non-null, this is the differentiating signal from the 1st-pass
  rubric** — Gate 4 (acceptance) and Gate 3 (scope) MUST account for the named
  pattern; do not re-emit the same verdict as if no failure had been observed.
- `prior_anchor_signatures` (handoff from `closure.clarify.scan-prior-verdicts`)
  — `Array<{ created_at,
  anchor_signature, verdict }>`. Chronological
  (ascending by `created_at`) ledger of every prior
  `<!-- clarifier-verdict-v1 -->` comment on this issue. Empty array means 1st
  clarifier pass on this issue. **Consumed by Gate 3 progress predicate** (see
  Step 3).
- `iterator_failure_timestamps` (handoff from same step) — `string[]`,
  chronological ISO 8601 timestamps of every `<!-- iterator-failure-v1
   -->`
  comment. Used by Gate 3 to detect "iterator failed AFTER my last
  `ready-to-impl`".
- Source-of-truth docs (read-only, for Gate 1 / 2 rationales):
  - `.agent/workflow-issue-states.md` (state machine, responsibility matrix)
  - `/CLAUDE.md` (tenets: 全域性 / Core-first / No BC / fallback 最小限 /
    reviewer precision)
- Codebase access via `Grep` / `Glob` / `Read` — for Gate 3 anchor discovery
  only.

Precondition (R4 fail-fast): the issue MUST carry the `need clearance` label.
The orchestrator's `blocked` phase queue gates this, but defend in depth: after
reading the issue (Action Step 1), if `labels[].name` does not include
`need clearance`, abort with `status: "failed"` (see `## Verdict` below) — do
not proceed to gates.

## Outputs

Emit one JSON object matching `closure.clarify` in
`schemas/clarifier.schema.json`. Required fields:

- `stepId: "clarify"`
- `status: "completed" | "failed"`
- `summary` — one-line human-readable summary
- `next_action.action: "closing"` (always — single-iteration; the schema enum is
  `["closing"]` only)
- `verdict: "ready-to-impl" | "ready-to-consider"`
- `rationale.gates` — exactly 5 entries (alignment, state-machine, scope,
  acceptance, dependency); each with `pass: boolean` and non-empty `note`
- `final_summary` — one-paragraph recap of verdict reasoning (used as
  commentTemplates variable on handoff)
- `anchor_signature` — sha256 hex (64 lowercase a-f0-9) of the canonicalized,
  sorted, newline-joined list of `Anchor:` strings emitted in the comment body.
  See `## Anchor signature`. Required on every emit, including failures and gate
  failures (use `e3b0c44...b855` (sha256 of empty string) when no anchor is
  printed).

Side effect (the only write channel): exactly one comment posted on issue
#{uv-issue} via `gh issue comment` (see `## Action` Step 5). Comment URL is
recorded by `gh` stdout but is not part of the structured output.

## Verdict

Always emit `next_action.action: "closing"`. This step is single-iteration
(`maxIterations: 1`); the orchestrator owns all phase / label transitions via
`outputPhases`. The schema enum is `["closing"]` — no other intent is declared,
allowed, or emitted.

The `verdict` field (separate from `next_action.action`) routes phase
transitions:

- All 5 gates pass AND `EXISTING_KIND = kind:impl` →
  `verdict = "ready-to-impl"`.
- All 5 gates pass AND `EXISTING_KIND = kind:consider` →
  `verdict = "ready-to-consider"`.
- All 5 gates pass AND `EXISTING_KIND` empty → pick via system-prompt
  rule-of-thumb table (`質問/相談/検討` → `ready-to-consider`, named
  files/functions + bug + repro → `ready-to-impl`, both → `ready-to-consider`).
- Any gate fails → `verdict = "ready-to-consider"` (considerer absorbs
  ambiguity; record the failing gate in the comment).

`EXISTING_KIND = kind:detail` → orchestrator will not dispatch clarifier to this
issue (`blocked` phase only fires when `need
clearance` is the actionable
label). If you somehow reach this state anyway, emit
`verdict = "ready-to-consider"` with `alignment` fail, note = "detailer-owned,
clarifier should not be invoked".

Fail-fast (R4): if precondition check finds `need clearance` is absent, emit
`status: "failed"`, `verdict: "ready-to-consider"`,
`summary: "missing need-clearance label — aborted before rubric"`, and
`anchor_signature:
"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"`
(sha256 of empty string — no anchor was computed). Do not post a comment, do not
run the rubric.

## Action

Execute every bash block via `bash -c '...'`. `set -euo pipefail` at the top of
each block. zsh has divergent `!` and here-string semantics that would cause
silent failures.

### Step 1 — Read the issue

```bash
bash -c '
set -euo pipefail
gh issue view {uv-issue} \
  --json number,title,body,labels,author,comments \
  > "$TMPDIR/clarifier-{uv-issue}-view.json"
cat "$TMPDIR/clarifier-{uv-issue}-view.json"
'
```

Parse:

- `title`, `body`
- `comments[].body` (read them all, in order)
- `labels[].name` — record `EXISTING_KIND` (`kind:impl` | `kind:consider` |
  `kind:detail` | empty)

Alternative read path: use the GitHubRead MCP tool (`mcp__github__github_read`
with `operation: "issue_view"`, `number: {uv-issue}`).

**Precondition check (fail-fast)**: if `labels[].name` does NOT contain
`need clearance`, stop here. Skip Steps 2–5 and emit `status: "failed"` per
`## Verdict` fail-fast clause.

### Step 2 — Research (evidence-only)

Investigate the question using read-only tools. Gate 1 / 2 require citations
from `.agent/workflow-issue-states.md` and `/CLAUDE.md`. Gate 3 requires a
`path:line` or `symbol` anchor found in the body, comments, or the codebase via
Grep/Glob/Read.

- Use `Grep` / `Glob` / `Read` on the codebase for Gate 3 anchor discovery.
- Use `Read` on `.agent/workflow-issue-states.md` and `/CLAUDE.md` for Gate 1 /
  2 rationales.
- Do NOT read other docs for judgment (source-of-truth discipline).

**When `iterator_failure_context` is non-null** (revision pass after a prior
iterator failure):

- Read `iterator_failure_context.pattern` and
  `iterator_failure_context.evidence_summary` first. These are facts the
  orchestrator carried forward; do not re-derive them from logs.
- Map the pattern to the gate it most directly affects:
  - `ac-evidence-missing` / `ac-typed-prefix-violated` → Gate 4 (acceptance).
    Inspect `iterator_failure_context.missing_acs` and name them in the comment.
  - `kind-boundary-breach` → Gate 3 (scope). Inspect
    `iterator_failure_context.kind_boundary.violations`.
  - `test-failed` / `type-error` / `lint-error` / `format-error` / `git-dirty` →
    Gate 4 (acceptance machine-checkability) plus Gate 3 if a specific path is
    named in `evidence_summary`.
  - `commit-binding-missing` / `off-run-only` / `branch-not-pushed` /
    `branch-not-merged` / `file-not-exists` → Gate 5 (dependency) — environment
    / commit state precondition.
  - `unspecified` → no automatic mapping; treat as 1st-pass behavior but record
    the failure existence in the comment.
- The 2nd-pass verdict MUST differ from a 1st-pass run: either refine the named
  gate (with stricter `note`) or escalate the failing-gate selection. Returning
  a byte-identical verdict is a R10-style livelock.

### Step 3 — Apply the 5-gate rubric

Evaluate in order. Record pass/fail + short note per gate.

1. **Gate 0 — kind coherence** (encoded inside `alignment`):
   - If `EXISTING_KIND` is non-empty, check whether your natural judgment
     matches. Mismatch → `alignment` = fail, note = "kind-conflict: existing
     `kind:X`, natural judgment `kind:Y`".
2. **Gate 1 — alignment (CLAUDE.md tenets)**: 全域性 / Core-first / No BC /
   fallback 最小限 / reviewer precision.
3. **Gate 2 — state-machine legality (workflow-issue-states.md)**: S0..S5
   transitions legal, responsibility matrix respected.
4. **Gate 3 — scope definiteness AND progress** (BOTH (a) AND (b)):

   **(a) scope definiteness** — at least one `path:line` or `symbol` anchor
   nameable from body + comments (+ codebase verify). On (a) fail: note =
   `scope-undefined`, set `anchor_signature` to sha256 of the empty string
   (`e3b0c44...b855`).

   **(b) progress predicate** — anchor reuse after iterator failure is
   forbidden. Compute `current_signature` per `## Anchor signature` (Step 3a).
   Then evaluate against the handoff ledgers:

   1. Let `last_ready_to_impl` = the most recent element of
      `prior_anchor_signatures` whose `verdict == "ready-to-impl"` (None if no
      such element).
   2. If `last_ready_to_impl` is None → predicate vacuously holds (1st pass, or
      only `ready-to-consider` so far). Gate 3 (b) PASS.
   3. Else, compare:
      - `current_signature == last_ready_to_impl.anchor_signature`, AND
      - any element of `iterator_failure_timestamps` is strictly later
        (lexicographic ISO 8601 comparison is correct) than
        `last_ready_to_impl.created_at`.
   4. If both conditions hold → Gate 3 (b) FAIL with note exactly:
      `progress-predicate-violated: anchor reused after iterator
      failure (prior verdict at <ISO>, signature <8-hex-prefix>...)`.
      Verdict is forced to `ready-to-consider`. Do NOT silently re-emit
      `ready-to-impl` even if (a) and Gates 1/2/4/5 all pass. (b) is independent
      of `iterator_failure_context` being null — orchestrator-level oscillation
      can occur even when the iterator's failure comment is missing or
      unparseable.

   On (a) PASS + (b) PASS → Gate 3 = pass, note = "anchor: <path:line>
   (signature <8-hex-prefix>... — fresh)".

   On (a) FAIL → Gate 3 = fail (regardless of (b)), note = a-clause.

   On (a) PASS + (b) FAIL → Gate 3 = fail with the (b) note above; include both
   anchor and signature.

5. **Gate 4 — acceptance criteria realizable**: at least one machine-checkable
   criterion (command exit, label state, output substring).
6. **Gate 5 — dependency resolvable**: no unresolved external deps mentioned.
   Pure function — no `gh issue view #DEP` recursion.

Short-circuit rule: the **first failing gate** determines the comment's "Failing
gate" line. Remaining gates MUST still be evaluated and recorded (the schema
requires all 5 entries). The verdict itself is locked to `ready-to-consider` as
soon as any gate fails.

### Step 3a — Compute `anchor_signature`

The signature is computed deterministically so the next-cycle scan step can
mechanically match anchors across cycles.

1. Collect every `Anchor:` string the verdict comment will print (Step 5
   template's `Anchor: <path:line | symbol>` lines, plus any additional anchors
   named in `Gate failures` if (a) PASS but (b) FAIL — include them too).
2. For each: trim leading/trailing whitespace.
3. Sort the list ascending lexicographically and deduplicate (identical strings
   collapse; case-sensitive).
4. Join with single `\n` (LF).
5. sha256 → lower-case 64-char hex.

When no anchor is emitted (Gate 3 (a) FAIL), use the sha256 of the empty string:
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

Reference computation (any deterministic implementation must agree):

```bash
bash -c '
set -euo pipefail
# Replace the heredoc body with your sorted, trimmed, deduplicated
# anchor list (one per line, no trailing newline). For empty list,
# echo -n "" | sha256sum.
printf "%s" "agents/orchestrator/dispatcher.ts:142
agents/runner/factory.ts:87" | sha256sum | cut -d" " -f1
'
```

Embed the result both in the structured output (`anchor_signature`) AND in the
posted comment body's second line as `<!-- anchor-signature: <sha256> -->` (Step
5 template).

### Step 4 — Decide verdict

Apply the rules in `## Verdict` above to pick `ready-to-impl` or
`ready-to-consider`.

### Step 5 — Compose + post the verdict comment

Follow the template in the system prompt exactly. Write the comment body to a
scratch file first, then post it.

```bash
bash -c '
set -euo pipefail
# Write the comment body to $TMPDIR first (multi-line markdown in
# shell args is fragile).
cat > "$TMPDIR/clarifier-{uv-issue}-comment.md" <<'"'"'EOF'"'"'
<!-- clarifier-verdict-v1 -->
<!-- anchor-signature: {anchor_signature} -->
## Clarifier verdict: <ready-to-impl | ready-to-consider>

### Judgment (5-gate rubric)
- alignment (Gate 1, incl. Gate 0 kind coherence): <pass|fail> — <note>
- state-machine (Gate 2): <pass|fail> — <note>
- scope (Gate 3): <pass|fail> — <note>
- acceptance (Gate 4): <pass|fail> — <note>
- dependency (Gate 5): <pass|fail> — <note>

### Interpreted scope (when any gate passed — always for ready-to-impl)
- Anchor: <path:line | symbol>
- Strategy: <1-3 lines>
- Acceptance criteria:
  - <bullet>
- References:
  - <workflow-issue-states.md:NN, CLAUDE.md §..., ...>

### Gate failures (only when at least one gate failed — verdict is ready-to-consider)
- Failing gate: <alignment | state-machine | scope | acceptance | dependency>
- What would unblock: <concrete criterion the human or considerer can act on>
EOF
# (The LLM overwrites the placeholder body before posting.)

gh issue comment {uv-issue} --body-file "$TMPDIR/clarifier-{uv-issue}-comment.md"
'
```

The `<!-- clarifier-verdict-v1 -->` line MUST be the first line of the comment
body (no preceding blanks / whitespace). The
`<!-- anchor-signature: <sha256> -->` line MUST be the second line and its
sha256 value MUST equal the structured-output `anchor_signature` field. The
next-cycle `closure.clarify.scan-prior-verdicts` step parses these two markers
deterministically — drift breaks the Gate 3 progress predicate.

`gh issue comment` is the only write subcommand you may invoke. It is
intentionally unblocked by `BOUNDARY_BASH_PATTERNS`; see
`agents/docs/builder/08_github_integration.md` §「コメント投稿の経路」.

### Step 6 — Emit structured output

Return a JSON object matching `closure.clarify` in
`schemas/clarifier.schema.json`:

```json
{
  "stepId": "clarify",
  "status": "completed",
  "summary": "<one-line summary>",
  "next_action": { "action": "closing" },
  "verdict": "ready-to-impl",
  "rationale": {
    "gates": [
      {
        "gate": "alignment",
        "pass": true,
        "note": "within Climpt core scope, kind:impl coherent"
      },
      {
        "gate": "state-machine",
        "pass": true,
        "note": "executor → orchestrator close boundary respected"
      },
      {
        "gate": "scope",
        "pass": true,
        "note": "anchor: agents/verdict/external-state-adapter.ts:197 (signature 7c3a91b2... — fresh)"
      },
      {
        "gate": "acceptance",
        "pass": true,
        "note": "deno test passes, label set matches expected"
      },
      {
        "gate": "dependency",
        "pass": true,
        "note": "no external deps mentioned"
      }
    ]
  },
  "final_summary": "<one-paragraph recap of verdict reasoning>",
  "anchor_signature": "7c3a91b2e0c4d2f8a1b6c9d3e7f2a1b8c5d6e9f0a3b4c7d8e1f2a3b4c5d6e7f8"
}
```

Rules:

- `verdict` MUST be `"ready-to-impl"` or `"ready-to-consider"`.
- `rationale.gates` MUST contain exactly 5 entries, one per gate name in the
  enum. Every entry needs a non-empty `note`.
- Gate failure is recorded via `gates[].pass = false` and surfaced in the
  comment's "Gate failures" section. The verdict itself remains
  `ready-to-consider` — no self-loop back to `blocked`.
- `next_action.action` is always `"closing"` (single-iteration).
- `anchor_signature` is required on every emit. For successful ready-to-impl
  with anchors → sha256 of the canonicalized anchor list per Step 3a. For Gate 3
  (a) failure (no anchor printed) → sha256 of empty string
  (`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`). For Gate
  3 (b) failure (anchor reused after iterator failure) → the same sha256 of the
  reused anchor list (this is the signal Gate 3 (b) is detecting; preserving it
  lets the downstream considerer / human reviewer see the duplication
  mechanically).

### Step 7 — Final status

Output a single-line summary:

```
clarifier: <verdict> #{uv-issue} (awaiting orchestrator label/phase transition)
```

On failure at any step, stop and report which step failed with the full command
output. Do not retry silently. Do NOT attempt `gh issue close`, `gh issue edit`,
or any label/body mutation.

## Do ONLY this

The single required action: read issue #{uv-issue}, apply the 5-gate rubric,
post exactly one comment, emit one JSON object per the schema.

Forbidden — all blocked by `BOUNDARY_BASH_PATTERNS` (see
`agents/common/tool-policy.ts`); they will be refused at the canUseTool hook, do
not attempt them:

- `gh issue edit <N>` with any option (labels, body, title, state)
- `gh issue close`
- `gh issue reopen` / `delete` / `transfer` / `pin` / `lock`
- `gh label create` / `edit` / `delete`
- `gh api <any-method>`
- `curl https://api.github.com/...` and equivalents via `wget` / `python` /
  `node` / `ruby` / `perl` / `deno`

Also forbidden:

- Editing the issue body (C3 — comment-only)
- Touching `order:N` labels (C2 — triager responsibility)
- Inventing scope not justified by body + comments
- Recursing into dependencies (`gh issue view #DEP` etc.)
- Emitting any `next_action.action` other than `"closing"` (schema enum is
  `["closing"]` only — any other value is a schema violation)
