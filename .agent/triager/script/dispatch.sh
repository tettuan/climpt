#!/usr/bin/env bash
#
# triager dispatcher (ad-hoc, not part of the product).
# Lists open issues that carry zero workflow labels, then runs the
# triager agent once per issue via `deno task agent --agent triager
# --issue <N>`. Sequential to avoid racing on order:N selection.
#
# Discard when climpt 本体 supports unlabeled-issue dispatch natively.
#
# Usage:
#   bash .agent/triager/script/dispatch.sh
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

# Open issues whose labels share zero entries with the workflow set.
# Note: --limit 200 is the gh API page; LIMIT below caps how many we dispatch.
TARGETS=$(gh issue list --state open --limit 200 \
  --json number,labels \
  | jq --argjson wl "$WORKFLOW_LABELS_JSON" --argjson lim "$LIMIT" '
      [ .[] | select(
          ([.labels[].name] | any(. as $n | $wl | index($n))) | not
        ) ]
      | .[:$lim]
      | map(.number)
    ')

COUNT=$(echo "$TARGETS" | jq 'length')

if [[ "$COUNT" == "0" ]]; then
  echo "no unlabeled open issues to triage."
  exit 0
fi

echo "triager dispatcher: $COUNT issue(s) to triage (limit=$LIMIT)"
echo "$TARGETS" | jq -r '.[]' | while read -r N; do
  echo "  -> #$N"
done

if [[ -n "$DRY_RUN" ]]; then
  echo "DRY_RUN=1 — not dispatching."
  exit 0
fi

# Sequential dispatch. Each invocation handles one issue; the order:N
# assigned by run i is visible (via gh) to run i+1.
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
  echo "==> dispatching triager for #$N"
  env -u CLAUDECODE deno task agent --agent triager --issue "$N" --workflow "$WORKFLOW"
done 3< <(echo "$TARGETS" | jq -r '.[]')

echo "triager dispatcher: done."
