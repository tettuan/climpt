#!/usr/bin/env bash
#
# triage-recovery dispatcher (ad-hoc, not part of the product).
# Lists open issues that are orphaned between the two pipelines —
# carry ≥1 workflow label but zero actionable-phase label — then runs
# the triage-recovery agent once per issue via
# `deno task agent --agent triage-recovery --issue <N>`.
# Sequential to avoid racing the boundary hook's gh edits.
#
# Discard when climpt 本体 supports orphan-issue dispatch natively.
#
# Usage:
#   bash .agent/triage-recovery/script/dispatch.sh
#
# Env overrides:
#   WORKFLOW  (default: .agent/workflow.json)
#   LIMIT     (default: 9)
#   DRY_RUN   (default: unset; set to 1 to print targets without dispatching)

set -euo pipefail

WORKFLOW="${WORKFLOW:-.agent/workflow.json}"
LIMIT="${LIMIT:-9}"
DRY_RUN="${DRY_RUN:-}"

if [[ ! -f "$WORKFLOW" ]]; then
  echo "workflow JSON not found: $WORKFLOW" >&2
  exit 1
fi

# Workflow label set: union of labelMapping keys and prioritizer.labels.
WORKFLOW_LABELS_JSON=$(jq '
  [ (.labelMapping // {} | keys[]),
    (.prioritizer.labels // [])[] ]
  | unique
' "$WORKFLOW")

# Actionable label set: labelMapping entries whose phase has type=="actionable".
ACTIONABLE_LABELS_JSON=$(jq '
  . as $w
  | [ (.labelMapping // {} | keys[])
      | select($w.labelMapping[.] as $ph
               | $ph != null
               and $w.phases[$ph].type == "actionable") ]
  | unique
' "$WORKFLOW")

# Open issues that are orphaned: carry ≥1 workflow label but zero actionable.
TARGETS=$(gh issue list --state open --limit 200 \
  --json number,labels \
  | jq --argjson wl "$WORKFLOW_LABELS_JSON" \
       --argjson al "$ACTIONABLE_LABELS_JSON" \
       --argjson lim "$LIMIT" '
      [ .[]
        | . as $iss
        | ($iss.labels | map(.name)) as $names
        | ($names | map(select(. as $n | $wl | index($n)))) as $wfHit
        | ($names | map(select(. as $n | $al | index($n)))) as $acHit
        | select(
            ($wfHit | length) > 0
            and ($acHit | length) == 0
          )
      ]
      | .[:$lim]
      | map(.number)
    ')

COUNT=$(echo "$TARGETS" | jq 'length')

if [[ "$COUNT" == "0" ]]; then
  echo "no orphan open issues to recover."
  exit 0
fi

echo "triage-recovery dispatcher: $COUNT issue(s) to recover (limit=$LIMIT)"
echo "$TARGETS" | jq -r '.[]' | while read -r N; do
  echo "  -> #$N"
done

if [[ -n "$DRY_RUN" ]]; then
  echo "DRY_RUN=1 — not dispatching."
  exit 0
fi

# Sequential dispatch. Each invocation handles one issue; the boundary
# hook strips its orphan labels, so subsequent gh queries (next
# dispatcher run) will see a fresh, clean state.
#
# `env -u CLAUDECODE` defangs the nested-session check that the Claude
# Code CLI applies when CLAUDECODE is set in the parent shell (e.g. when
# this script is run from inside a Claude Code Bash tool). On a normal
# terminal CLAUDECODE is unset and `env -u` is a no-op.
#
# Drive the loop's `read` from FD 3, not stdin. The Claude Code SDK
# inside `deno task agent` consumes stdin (FD 0); with `cmd | while
# read` or even `done < <(...)`, FD 0 of the inner command inherits the
# loop's input source and the agent drains the remaining issue numbers,
# causing the dispatcher to exit after one iteration. Binding the loop
# to FD 3 keeps the agent's stdin attached to the parent terminal.
while read -r N <&3; do
  echo "==> dispatching triage-recovery for #$N"
  env -u CLAUDECODE deno task agent --agent triage-recovery --issue "$N" --workflow "$WORKFLOW"
done 3< <(echo "$TARGETS" | jq -r '.[]')

echo "triage-recovery dispatcher: done."
