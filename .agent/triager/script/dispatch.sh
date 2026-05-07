#!/usr/bin/env bash
#
# triager dispatcher (ad-hoc, not part of the product).
# Lists open issues that carry no kind:* label, then runs the triager
# agent once per issue via `deno task agent --agent triager --issue <N>`.
# Sequential because per-issue dispatch makes parallelism unnecessary
# (each invocation only labels its own target).
#
# Triager assigns kind:* only. order:N is the prioritizer's
# responsibility (see .agent/prioritizer/README.md once it lands).
#
# Discard when climpt 本体 supports kind-less issue dispatch natively.
#
# Usage:
#   bash .agent/triager/script/dispatch.sh
#
# Env overrides:
#   WORKFLOW  (default: .agent/workflow.json)
#   LIMIT     (default: 9)
#   PROJECT   (default: unset; <owner>/<number>, e.g. tettuan/41 — restrict
#              dispatch to issues that belong to this GitHub Project v2)
#   DRY_RUN   (default: unset; set to 1 to print targets without dispatching)

set -euo pipefail

WORKFLOW="${WORKFLOW:-.agent/workflow.json}"
LIMIT="${LIMIT:-9}"
PROJECT="${PROJECT:-}"
DRY_RUN="${DRY_RUN:-}"

if [[ ! -f "$WORKFLOW" ]]; then
  echo "workflow JSON not found: $WORKFLOW" >&2
  exit 1
fi

PROJECT_OWNER=""
PROJECT_NUMBER=""
if [[ -n "$PROJECT" ]]; then
  if [[ ! "$PROJECT" =~ ^[^/]+/[0-9]+$ ]]; then
    echo "Invalid PROJECT: '$PROJECT'. Must be <owner>/<number> (e.g. tettuan/41)." >&2
    exit 1
  fi
  PROJECT_OWNER="${PROJECT%/*}"
  PROJECT_NUMBER="${PROJECT##*/}"
fi

# Kind label set: labelMapping keys filtered to entries starting with "kind:".
# Triager skip rule = "carries any kind:* label". order:* / done /
# need clearance presence does NOT make an issue ineligible because
# triager only owns kind:* assignment.
KIND_LABELS_JSON=$(jq '
  .labelMapping // {}
  | keys
  | map(select(startswith("kind:")))
' "$WORKFLOW")

# Issue numbers belonging to the requested project (if any). Mirrors
# GhCliClient.listProjectItems in agents/orchestrator/github-client.ts.
PROJECT_ISSUES_JSON="null"
if [[ -n "$PROJECT" ]]; then
  PROJECT_ISSUES_JSON=$(gh project item-list "$PROJECT_NUMBER" \
    --owner "$PROJECT_OWNER" --format json \
    | jq '[ .items[] | select(.content.type == "Issue") | .content.number ]')
  PROJECT_COUNT=$(echo "$PROJECT_ISSUES_JSON" | jq 'length')
  echo "project filter: $PROJECT ($PROJECT_COUNT issue(s) in project)"
fi

# Open issues whose labels share zero entries with the kind:* set,
# optionally intersected with the project's issue numbers.
# Note: --limit 200 is the gh API page; LIMIT below caps how many we dispatch.
TARGETS=$(gh issue list --state open --limit 200 \
  --json number,labels \
  | jq --argjson kl "$KIND_LABELS_JSON" \
       --argjson pi "$PROJECT_ISSUES_JSON" \
       --argjson lim "$LIMIT" '
      [ .[] | select(
          (([.labels[].name] | any(. as $n | $kl | index($n))) | not)
          and ($pi == null or (.number | IN($pi[])))
        ) ]
      | .[:$lim]
      | map(.number)
    ')

COUNT=$(echo "$TARGETS" | jq 'length')

if [[ "$COUNT" == "0" ]]; then
  echo "no kind-less open issues to triage."
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

# Sequential dispatch. Each invocation handles one issue. Sequential
# execution is for log clarity and to bound concurrent gh calls; with
# triager's classify-only role there is no global state to race on.
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
