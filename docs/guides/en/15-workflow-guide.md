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
  "rules": { "maxCycles": 5, "cycleDelayMs": 10000 }
}
```

2. Add a `ready` label to a GitHub issue.

3. Run the workflow:

```bash
deno task orchestrator --label ready --state open
```

## workflow.json Structure

### Top-Level Fields

| Field          | Required | Default                                | Description                                                   |
| -------------- | -------- | -------------------------------------- | ------------------------------------------------------------- |
| `version`      | yes      | —                                      | Schema version (e.g., `"1.0.0"`)                              |
| `phases`       | yes      | —                                      | Phase definitions (see below)                                 |
| `labelMapping` | yes      | —                                      | GitHub label → phase ID mapping                               |
| `agents`       | yes      | —                                      | Agent definitions (see below)                                 |
| `rules`        | yes      | —                                      | Execution constraints (see below)                             |
| `labelPrefix`  | no       | —                                      | Label namespace (e.g., `"docs"` → labels become `docs:ready`) |
| `issueStore`   | no       | `{ path: ".agent/climpt/tmp/issues" }` | Local issue storage directory                                 |
| `handoff`      | no       | —                                      | Inter-agent handoff comment templates                         |
| `prioritizer`  | no       | —                                      | Prioritizer agent configuration (required for `--prioritize`) |

### phases

Defines the workflow states. Each phase has a `type`:

- `actionable` — An agent runs. Requires `agent` and `priority`.
- `terminal` — Workflow ends.
- `blocking` — Waits for human intervention.

| Field      | Required       | Description                                                      |
| ---------- | -------------- | ---------------------------------------------------------------- |
| `type`     | yes            | `"actionable"`, `"terminal"`, or `"blocking"`                    |
| `priority` | for actionable | Lower number = higher priority. Used when multiple labels match. |
| `agent`    | for actionable | Agent ID to dispatch (must exist in `agents`)                    |

### labelMapping

Maps GitHub labels to phase IDs. Multiple labels can map to the same phase.
Unknown labels are ignored.

### agents

Defines agent behavior:

- **Transformer** (`role: "transformer"`) — Single output. On success goes to
  `outputPhase`, on error to `fallbackPhase`.
- **Validator** (`role: "validator"`) — Multiple outputs via `outputPhases` map
  (e.g., `approved` → complete, `rejected` → revision).

| Field           | Required        | Description                                                 |
| --------------- | --------------- | ----------------------------------------------------------- |
| `role`          | yes             | `"transformer"` or `"validator"`                            |
| `directory`     | no              | Agent directory name under `.agent/` (defaults to agent ID) |
| `outputPhase`   | for transformer | Target phase on success                                     |
| `outputPhases`  | for validator   | Outcome key → target phase mapping                          |
| `fallbackPhase` | no              | Target phase on error (typically `"blocked"`)               |

### rules

| Field          | Default | Description                                                       |
| -------------- | ------- | ----------------------------------------------------------------- |
| `maxCycles`    | 5       | Max transitions per issue (loop guard)                            |
| `cycleDelayMs` | 10000   | Delay between cycles (ms); shows countdown with safe-stop message |

### prioritizer

Required when using `--prioritize`. Configures the priority assignment agent.

| Field          | Required | Description                                                   |
| -------------- | -------- | ------------------------------------------------------------- |
| `agent`        | yes      | Agent ID to dispatch for prioritization                       |
| `labels`       | yes      | Allowed priority labels in order (e.g., `["P1", "P2", "P3"]`) |
| `defaultLabel` | no       | Fallback label when priority is missing or invalid            |

### handoff

Configures comment templates posted to GitHub issues during agent handoff
transitions.

```json
"handoff": {
  "commentTemplates": {
    "<templateKey>": "<template string with {variables}>"
  }
}
```

**Template key naming convention:**

The orchestrator resolves a template key for each handoff using the agent ID and
the transition outcome:

1. Look up `{agentId}{Outcome}` (e.g., `reviewerApproved`).
2. Fall back to `{agentId}To{Outcome}` (e.g., `reviewerToApproved`).
3. Outcome is capitalized (`"approved"` becomes `"Approved"`).
4. If no matching template is found, no comment is posted (silent no-op).

**Template variables:**

Template variables are defined by the agent builder, not the framework.
Configure in two places:

1. Define fields in the closure step's output schema (e.g.,
   `"final_summary": { "type": "string" }`).
2. List fields to export in the closure step's `handoffFields` (e.g.,
   `["final_summary"]`).

Variables listed in `handoffFields` become available as `{field_name}` in
templates. Unmatched variables are preserved as literal text in the output.

**Example** using the iterator/reviewer agents from the quick start:

```json
// steps_registry.json — closure step
"handoffFields": ["final_summary"]
```

```json
// workflow.json
"handoff": {
  "commentTemplates": {
    "iteratorSuccess": "[Handoff] Implementation complete.\n\n{final_summary}",
    "reviewerApproved": "[Review Complete] All requirements verified.\n\n{final_summary}",
    "reviewerRejected": "[Review] Gaps found.\n\n{final_summary}"
  }
}
```

**Template key mapping** for the standard iterator/reviewer workflow:

| Agent    | Outcome  | Template Key       |
| -------- | -------- | ------------------ |
| iterator | success  | `iteratorSuccess`  |
| iterator | failed   | `iteratorFailed`   |
| reviewer | approved | `reviewerApproved` |
| reviewer | rejected | `reviewerRejected` |

## Running Workflows

```bash
# Process a single issue
deno task orchestrator --issue 123

# Single issue dry run
deno task orchestrator --issue 123 --dry-run --verbose

# Process open issues with a specific label (batch mode)
deno task orchestrator --label ready --state open

# Custom workflow file
deno task orchestrator --label docs --workflow .agent/workflow-docs.json

# Dry run (no GitHub changes)
deno task orchestrator --label ready --dry-run --verbose

# Prioritize only (assign priority labels, no agent dispatch)
deno task orchestrator --label ready --prioritize

# Multiple label filters
deno task orchestrator --label P1 --label docs --state open --limit 10
```

### `--label` vs `labelPrefix`

`--label` and `labelPrefix` are independent concepts:

| Concept       | Where           | What it does                                                                |
| ------------- | --------------- | --------------------------------------------------------------------------- |
| `--label`     | CLI argument    | Filters which issues to fetch from GitHub (`gh issue list --label <value>`) |
| `labelPrefix` | `workflow.json` | Namespaces workflow labels (e.g., `ready` becomes `docs:ready`)             |

`--label` selects issues to process. `labelPrefix` controls how the orchestrator
reads and writes phase labels during transitions. They do not affect each other.

Example: `--label docs` fetches issues that have a `docs` label. The
orchestrator then reads the issue's other labels (e.g., `ready`) to resolve the
current phase and manages transitions using `labelMapping`. The `docs` label
itself is not in `labelMapping`, so it remains untouched throughout the
workflow.

### CLI Options

| Option         | Type    | Default                | Description                                  |
| -------------- | ------- | ---------------------- | -------------------------------------------- |
| `--issue`      | number  | —                      | Process a single issue (skips batch sync)    |
| `--workflow`   | string  | `.agent/workflow.json` | Workflow file path                           |
| `--label`      | string  | —                      | GitHub issue filter (repeatable, batch mode) |
| `--repo`       | string  | current                | Repository (`owner/repo`)                    |
| `--state`      | string  | `open`                 | `open` / `closed` / `all`                    |
| `--limit`      | number  | `30`                   | Max issues to fetch                          |
| `--prioritize` | boolean | false                  | Run prioritizer only (batch mode)            |
| `--verbose`    | boolean | false                  | Detailed log output                          |
| `--dry-run`    | boolean | false                  | Show what would happen without acting        |
| `--local`      | boolean | false                  | Use local IssueStore (skip GitHub sync)      |

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

### Per-Issue Status

- `"completed"` — Reached a terminal phase.
- `"blocked"` — Reached a blocking phase or no actionable labels found.
- `"cycle_exceeded"` — Hit `maxCycles` limit.
- `"dry-run"` — Actionable phase resolved; would dispatch but `--dry-run`
  skipped it.

### Batch Status

- `"completed"` — All issues processed without errors (includes empty batches
  and all-terminal batches).
- `"partial"` — At least one issue caused a processing error.
- `"failed"` — Batch could not start (e.g., workflow lock already held).

### Exit Codes

| Mode         | Condition                                | Exit Code |
| ------------ | ---------------------------------------- | --------- |
| Single issue | `status` is `"completed"` or `"dry-run"` | 0         |
| Single issue | `status` is `"blocked"` or other         | 1         |
| Batch        | `status` is `"completed"`                | 0         |
| Batch        | `status` is `"partial"` or `"failed"`    | 1         |

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
deno task orchestrator --label docs:ready --workflow .agent/workflow-docs.json
deno task orchestrator --label impl:ready --workflow .agent/workflow-impl.json
```

## Troubleshooting

| Symptom                             | Cause                                     | Fix                                    |
| ----------------------------------- | ----------------------------------------- | -------------------------------------- |
| No issues processed                 | No matching labels on open issues         | Check `--label` and `--state` filters  |
| Agent not dispatched                | Phase resolved as blocking/terminal       | Verify `labelMapping` and phase types  |
| Cycle limit exceeded                | Too many transitions                      | Increase `maxCycles` or fix loop logic |
| Unknown label ignored               | Label not in `labelMapping`               | Add the label to `labelMapping`        |
| Validation error on load            | Cross-reference mismatch in workflow.json | Check agent/phase references exist     |
| `--prioritize` fails (WF-BATCH-001) | Missing `prioritizer` config              | Add `prioritizer` section to workflow  |
