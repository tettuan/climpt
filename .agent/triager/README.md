# Triager Agent

Single responsibility: **classify** one open GitHub Issue into a `kind:*`
phase label. Per-issue dispatch via `--issue <N>`.

```
triager(issue) → adds kind:impl | kind:consider | kind:design
```

## What triager IS

- A **classifier**. Reads `title + body` of one issue and assigns exactly one
  `kind:*` label that maps to a phase in `.agent/workflow.json#labelMapping`.
- Per-issue: never sees more than one issue per invocation.
- Label-only: emits a closure structured output; the poll:state boundary
  hook applies the label via `gh issue edit`.

## What triager is NOT

- **Not a prioritizer.** Triager does NOT decide work order. The `order:N`
  label is the prioritizer's responsibility (separate agent — see below).
  Priority is a *comparative* decision over the whole open-issue set; a
  per-issue dispatch sees only one issue and cannot rank.
- Not a queue manager.
- Not an issue closer (`defaultClosureAction: "label-only"`).
- Not a comment poster.

## Why classification and prioritization are split

Up to commit `0171945`, triager assigned `kind:* + order:N` together. This
broke when the per-issue dispatch refactor removed the global view: the
agent began allocating "smallest unused order:N" by querying `gh issue
list`, which is **arrival-order serial allocation**, not priority. A new
issue that should run first cannot displace an existing `order:1`.

The split restores the design intent:

| Agent | Decides | Sees | Cardinality |
|---|---|---|---|
| triager | classification (`kind:*`) | one issue | per-issue |
| prioritizer | order (`order:N`) | all open candidates | batch |

`workflow.json#prioritizer.agent` points to the prioritizer agent, NOT to
triager. The orchestrator's `--prioritize` mode (`agents/orchestrator/batch-runner.ts:142-187`)
dispatches the prioritizer once with the full candidate list via
`issue-list.json` and reads back `priorities.json`.

## Inputs

- `--issue <N>` (required) — target issue number.
- `--workflow <path>` (default `.agent/workflow.json`) — used to derive the
  workflow label set for the eligibility check.
- `--repository <owner/repo>` (optional) — overrides the gh context.

## Eligibility

Triager refuses to relabel an issue that already carries any `kind:*`
label. Other workflow labels (`order:*`, `done`, `need clearance`) do NOT
make an issue ineligible — only `kind:*` presence does, because that is
what triager itself owns.

## Output contract

```json
{
  "stepId": "triage",
  "status": "completed",
  "summary": "classified #<N> as <kind>",
  "next_action": { "action": "closing" },
  "issue": {
    "number": <N>,
    "labels": {
      "add": ["kind:<impl|consider|design>"]
    }
  }
}
```

`labels.add` carries exactly one element — the chosen `kind:*` label. The
boundary hook applies it; `defaultClosureAction: "label-only"` keeps the
issue open so the prioritizer can pick it up next.

## How to run

Single issue:

```bash
deno task agent --agent triager --issue 523
```

Fan-out over all open issues that have no `kind:*` label, optionally
scoped to a GitHub Project v2:

```bash
bash .agent/triager/script/dispatch.sh
PROJECT=tettuan/41 bash .agent/triager/script/dispatch.sh
```

See `.agent/triager/script/README.md` for dispatcher details.

## Files

| Path | Purpose |
|---|---|
| `agent.json` | runner config, parameters, verdict type, logging |
| `prompts/system.md` | persona, output discipline, classification heuristics |
| `prompts/steps/closure/triage/f_default.md` | per-issue execution recipe |
| `schemas/triager.schema.json` | structured output schema |
| `steps_registry.json` | step registry for the C3L loader |
| `script/dispatch.sh` | ad-hoc fan-out shell (lists kind-less issues, calls triager once each) |

## Boundaries (summary)

- Do NOT assign `order:N` (prioritizer's role).
- Do NOT close issues, post comments, or call `gh issue edit` directly.
- Do NOT touch issues that already carry a `kind:*` label.
- Do NOT remove pre-existing non-workflow labels (`enhancement`, `bug`, ...).

## Status

Per-issue dispatch via `dispatch.sh` is ad-hoc; the long-term plan is for
the product orchestrator to natively dispatch unlabeled issues. Discard
the shell dispatcher when that lands.
