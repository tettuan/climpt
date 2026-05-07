# Triage Recovery — Ad-hoc Dispatcher

**Status: ad-hoc, not part of the product.**

This directory contains a temporary shell-level dispatcher that fans
out **orphan** open issues to the triage-recovery agent (which now
operates in per-issue dispatch mode via `--issue <N>`).

## Why

An orphan issue carries ≥1 workflow label but **zero** actionable-phase
labels. Both pipelines skip it:

- The triager (`agents/orchestrator/...`) skips anything that already
  carries a workflow label.
- The orchestrator (`agents/orchestrator/label-resolver.ts`) skips
  anything without a label mapped to an actionable phase.

The intersection is invisible to both pipelines forever. The
triage-recovery agent strips the orphan workflow labels so the issue
falls back to the unlabeled state and the triager re-classifies it on
the next run.

The product orchestrator does not have an entry path for orphan issues
(it requires an actionable label to dispatch), so the agent must be
launched per-issue from outside. This shell script bridges the gap. It
uses only `gh` and `deno task agent`; no TS, no orchestrator wiring.

## Lifetime

Discard when climpt 本体起動 supports orphan-issue dispatch. At that
point this directory should be deleted in the same commit that adds the
product path.

## Files

- `dispatch.sh` — list orphan open issues, run the triage-recovery
  agent once per issue, sequentially.

## How to run

```bash
bash .agent/triage-recovery/script/dispatch.sh
```

Optional environment overrides:

- `WORKFLOW` (default `.agent/workflow.json`) — workflow JSON used to
  derive `WORKFLOW_LABELS` and `ACTIONABLE_LABELS`.
- `LIMIT` (default `9`) — max number of issues to dispatch in one run.
- `DRY_RUN=1` — print the issue numbers that would be dispatched, do
  not invoke the agent.

## Why sequential

Each agent invocation strips labels from its target issue via the
poll:state boundary hook. Sequential execution keeps the gh state
consistent for any tooling (or human) inspecting issues mid-run.
Parallel dispatch would not corrupt correctness (each issue is
independent) but interleaved log output would be hard to read.
