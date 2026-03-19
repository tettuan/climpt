# Workflow Guide

How to define and run multi-agent workflows with the orchestrator.

## Overview

The orchestrator coordinates multiple agents through a label-driven state
machine. You define phases, agents, and transitions in a `workflow.json` file.
GitHub issue labels serve as the workflow state — the orchestrator reads labels,
dispatches agents, and updates labels based on outcomes.

## Prerequisites

- Climpt installed and configured ([02-climpt-setup.md](02-climpt-setup.md))
- At least one agent set up under `.agent/` (e.g., iterator, reviewer)
- `gh` CLI installed and authenticated
- GitHub repository with issues to process

## Quick Start

1. Create `.agent/workflow.json`:

```json
{
  "$schema": "../../agents/orchestrator/workflow-schema.json",
  "version": "1.0.0",
  "phases": {
    "implementation": {
      "type": "actionable",
      "priority": 3,
      "agent": "iterator"
    },
    "review": { "type": "actionable", "priority": 2, "agent": "reviewer" },
    "revision": { "type": "actionable", "priority": 1, "agent": "iterator" },
    "complete": { "type": "terminal" },
    "blocked": { "type": "blocking" }
  },
  "labelMapping": {
    "ready": "implementation",
    "review": "review",
    "implementation-gap": "revision",
    "done": "complete",
    "blocked": "blocked"
  },
  "agents": {
    "iterator": {
      "role": "transformer",
      "directory": "iterator",
      "outputPhase": "review",
      "fallbackPhase": "blocked"
    },
    "reviewer": {
      "role": "validator",
      "directory": "reviewer",
      "outputPhases": { "approved": "complete", "rejected": "revision" },
      "fallbackPhase": "blocked"
    }
  },
  "rules": { "maxCycles": 5, "cycleDelayMs": 5000 }
}
```

2. Add a `ready` label to a GitHub issue.

3. Run the workflow:

```bash
deno task workflow --label ready --state open
```

## workflow.json Structure

### phases

Defines the workflow states. Each phase has a `type`:

- `actionable` — An agent runs. Requires `agent` and `priority`.
- `terminal` — Workflow ends.
- `blocking` — Waits for human intervention.

### labelMapping

Maps GitHub labels to phase IDs. Multiple labels can map to the same phase.
Unknown labels are ignored.

### agents

Defines agent behavior:

- **Transformer** (`role: "transformer"`) — Single output. On success goes to
  `outputPhase`, on error to `fallbackPhase`.
- **Validator** (`role: "validator"`) — Multiple outputs via `outputPhases` map
  (e.g., `approved` → complete, `rejected` → revision).

### rules

| Field        | Default | Description                            |
| ------------ | ------- | -------------------------------------- |
| maxCycles    | 5       | Max transitions per issue (loop guard) |
| cycleDelayMs | 5000    | Delay between cycles (ms)              |

## Running Workflows

```bash
# Process open issues with a specific label
deno task workflow --label ready --state open

# Custom workflow file
deno task workflow --label docs --workflow .agent/workflow-docs.json

# Dry run (no GitHub changes)
deno task workflow --label ready --dry-run --verbose

# Prioritize only (assign priority labels, no agent dispatch)
deno task workflow --label ready --prioritize

# Multiple label filters
deno task workflow --label P1 --label docs --state open --limit 10
```

### CLI Options

| Option         | Type    | Default                | Description                 |
| -------------- | ------- | ---------------------- | --------------------------- |
| `--workflow`   | string  | `.agent/workflow.json` | Workflow file path          |
| `--label`      | string  | —                      | Label filter (repeatable)   |
| `--repo`       | string  | current                | Repository (`owner/repo`)   |
| `--state`      | string  | `open`                 | `open` / `closed` / `all`   |
| `--limit`      | number  | `30`                   | Max issues to fetch         |
| `--prioritize` | boolean | false                  | Run prioritizer only        |
| `--verbose`    | boolean | false                  | Detailed log output         |
| `--dry-run`    | boolean | false                  | Show changes without acting |

## Understanding Output

The orchestrator outputs a JSON result:

```json
{
  "processed": [
    {
      "issueNumber": 123,
      "finalPhase": "complete",
      "cycleCount": 2,
      "status": "completed"
    }
  ],
  "skipped": [],
  "totalIssues": 1,
  "status": "completed"
}
```

- `status: "completed"` — Reached a terminal phase.
- `status: "blocked"` — Reached a blocking phase or no actionable labels found.
- `status: "cycle_exceeded"` — Hit `maxCycles` limit.

## Multi-Workflow Setup

Use `labelPrefix` to run multiple workflows on the same repository without label
collisions:

```json
{
  "labelPrefix": "docs",
  "labelMapping": {
    "ready": "implementation",
    "review": "review"
  }
}
```

GitHub labels become `docs:ready`, `docs:review`, etc. The `labelMapping` keys
remain bare names.

Run with a custom workflow file:

```bash
deno task workflow --label docs:ready --workflow .agent/workflow-docs.json
deno task workflow --label impl:ready --workflow .agent/workflow-impl.json
```

## Troubleshooting

| Symptom                  | Cause                                     | Fix                                    |
| ------------------------ | ----------------------------------------- | -------------------------------------- |
| No issues processed      | No matching labels on open issues         | Check `--label` and `--state` filters  |
| Agent not dispatched     | Phase resolved as blocking/terminal       | Verify `labelMapping` and phase types  |
| Cycle limit exceeded     | Too many transitions                      | Increase `maxCycles` or fix loop logic |
| Unknown label ignored    | Label not in `labelMapping`               | Add the label to `labelMapping`        |
| Validation error on load | Cross-reference mismatch in workflow.json | Check agent/phase references exist     |
| `--prioritize` fails     | Missing `prioritizer` config              | Add `prioritizer` section to workflow  |
