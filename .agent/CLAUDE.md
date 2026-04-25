# .agent/

The agents in this directory are defined for the Climpt project itself.
They are not part of the published package and are not included in JSR distribution.

## For viewers (users who found this directory)

These agents are project-specific configurations used to develop and test Climpt's agent runner.
They are not default agents, not starter templates, and not intended for reuse in other projects.

To create your own agent, see `agents/docs/builder/01_quickstart.md`.

## For Climpt developers

These agents serve as the primary test targets for the agent runner implementation.
Changes to the runner should be validated against these configurations.

| Agent       | Purpose                              |
|-------------|--------------------------------------|
| iterator    | Development task execution via Issues |
| reviewer    | Code review and verification         |
| climpt      | MCP command registry and prompts     |
| triager     | Classify unlabeled issues (kind:* + order:N) |
| triage-recovery | Per-issue: strip orphan workflow labels from one issue both triager and orchestrator skip (poll:state, label-only) |
| considerer  | Respond to kind:consider issues and close them |
| detailer    | Detail a kind:detail issue (spec) before iterator picks it up |
| clarifier   | Scan need-clearance issues, apply 5-gate rubric, re-queue or record reason |
| merger      | Deterministic PR merge closure       |

## Issue handling flow (triage → execute)

Two-stage pipeline for GitHub Issues:

1. **Triage** (standalone agent, bypasses orchestrator):

   ```bash
   deno task agent --agent triager
   # or with explicit downstream workflow:
   deno task agent --agent triager --workflow .agent/workflow.json
   ```

   Triager reads the downstream workflow JSON (default
   `.agent/workflow.json`) to derive the **workflow label
   set** dynamically from `labelMapping` keys + `prioritizer.labels`. It
   bootstraps any missing labels in the repo, then scans all open issues
   that carry **none** of the workflow labels (issues with only unrelated
   tags like `enhancement` remain eligible), classifies each as `kind:impl`
   or `kind:consider`, and assigns a unique `order:N` (N = 1..9, lowest
   unused) work-order label.

2. **Execute** (orchestrator workflow):

   ```bash
   deno task orchestrator
   # or with explicit workflow path:
   deno task orchestrator --workflow .agent/workflow.json
   ```

   Picks up labeled issues in `order:N` ascending order. Routes
   `kind:impl` → iterator (transformer), `kind:consider` → considerer
   (transformer, closes the issue after responding). Transitions to
   `done` (terminal) or `blocked` (blocking) phase on completion.

   Single-issue mode: append `--issue <N>` to target one issue.

3. **Orphan recovery** (ad-hoc, per-issue dispatch):

   Issues that carry ≥1 workflow label but **zero** actionable-phase
   labels are invisible to both triager and orchestrator. The
   triage-recovery agent strips the orphan workflow labels so the
   issue falls back to the unlabeled state and re-enters triage on
   the next run.

   ```bash
   bash .agent/triage-recovery/script/dispatch.sh
   ```

   See `.agent/triage-recovery/script/README.md`. Discard when the
   product orchestrator supports orphan-issue dispatch directly.

Repository labels (name, color, description) are the declarative source
of truth in `.agent/workflow.json` under the `labels` section. The
orchestrator reconciles them on every batch start, and the triager does
the same via `deno task labels:sync` as its Step 1. Contributors who add
or rename a workflow label MUST update `labels` in `workflow.json` —
never the triager prompt (which now only invokes the syncer).

## Directory layout

The top-level convention under `.agent/` is one directory per agent
(`.agent/{agent-name}/`). Anything that is not owned by a single agent —
shared runtime artifacts, cross-agent handoff drops, common output state —
MUST live under `.agent/climpt/`, never at `.agent/<top-level>/`.

| Path | Owner | Purpose |
|------|-------|---------|
| `.agent/{agent-name}/` | one agent | source files (agent.json, prompts/, schemas/, steps_registry.json) |
| `.agent/climpt/tmp/issues-execute/<N>/outbox/` | shared | per-issue handoff outbox, subject store |
| `.agent/climpt/out/` | shared | shared runtime output (e.g. `kind_at_triage/<N>.txt` written by triager and read by iterator/considerer) |
| `.agent/workflow.json` | shared | workflow definition, labels, projectBinding |

When introducing a new shared artifact, place it under `.agent/climpt/` and
reference it from the consuming agents' prompts. Do NOT create new top-level
directories like `.agent/out/` — that violates the per-agent convention and
makes the writer ambiguous (`.agent/out/` could be written by anyone).

## Operating contexts

When working with `.agent/`, determine which context applies before acting.

| # | Context | What it means | Example |
|---|---------|---------------|---------|
| 1 | Development | Editing repo files (agent.json, prompts, schemas) as source code | Fix a schema field, add a prompt template, update steps_registry |
| 2 | Local execution | Running agents with the local (unreleased) codebase | `deno task agent --agent iterator` to test runner changes |
| 3 | JSR consumer | Using the published package as an end user | `deno run -A jsr:@aidevtool/climpt/agents/runner --agent my-agent` |

Context 1 changes source files. Context 2 exercises them locally. Context 3 does not involve this directory (`.agent/` is excluded from JSR).

When receiving an instruction that involves `.agent/`, identify which context it belongs to before executing.
