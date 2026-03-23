#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLES_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${EXAMPLES_DIR}/.." && pwd)"
cd "$EXAMPLES_DIR"
source "${EXAMPLES_DIR}/common_functions.sh"

WORKFLOW_CMD="deno run --allow-all ${REPO_ROOT}/agents/scripts/run-workflow.ts"
FIXTURES="${EXAMPLES_DIR}/fixtures/workflow"

# Set up a temp workdir with given labels and optional maxCycles override
setup_workdir() {
  local labels_json="$1"
  local max_cycles="${2:-5}"
  local tmp
  tmp=$(mktemp -d)
  mkdir -p "$tmp/.agent/climpt/tmp/issues/1/comments"
  cp "$FIXTURES/issues/1/body.md" "$tmp/.agent/climpt/tmp/issues/1/body.md"

  # Write meta with custom labels
  cat > "$tmp/.agent/climpt/tmp/issues/1/meta.json" <<METAEOF
{
  "number": 1,
  "title": "Test issue",
  "labels": ${labels_json},
  "state": "open",
  "assignees": [],
  "milestone": null
}
METAEOF

  # Write workflow config (jq to override maxCycles)
  jq ".rules.maxCycles = ${max_cycles}" "$FIXTURES/workflow.json" \
    > "$tmp/.agent/workflow.json"

  echo "$tmp"
}

# Read labels from meta.json using jq
read_labels() {
  local meta_path="$1"
  jq -c '.labels' "$meta_path"
}

main() {
  info "=== Workflow Transition: Phase Changes via File I/O (CLI E2E) ==="

  check_deno
  check_command jq

  local fail=0

  # Scenario 1: ready → review → done (full transition)
  info "Scenario 1: ready → review → done (completed)"
  local tmp output
  tmp=$(setup_workdir '["ready"]')
  output=$(cd "$tmp" && $WORKFLOW_CMD --local --issue 1 \
    --stub-dispatch '{"iterator":"success","reviewer":"approved"}' 2>&1) || true

  # Check JSON output
  if echo "$output" | grep -q '"completed"'; then
    : # status is completed
  else
    error "Scenario 1: FAIL - status not 'completed'"
    echo "$output"
    fail=1
  fi
  if echo "$output" | grep -q '"cycleCount": 2'; then
    : # correct cycle count
  else
    error "Scenario 1: FAIL - cycleCount not 2"
    echo "$output"
    fail=1
  fi

  # Check file system: meta.json should have "done" label, no "ready"
  local labels
  labels=$(read_labels "$tmp/.agent/climpt/tmp/issues/1/meta.json")
  if echo "$labels" | grep -q '"done"'; then
    if echo "$labels" | grep -qv '"ready"'; then
      success "Scenario 1: PASS"
    else
      error "Scenario 1: FAIL - 'ready' label still present: $labels"
      fail=1
    fi
  else
    error "Scenario 1: FAIL - 'done' label missing: $labels"
    fail=1
  fi
  rm -rf "$tmp"

  # Scenario 2: ready → blocked (iterator fails)
  info "Scenario 2: ready → blocked (iterator failure)"
  tmp=$(setup_workdir '["ready"]')
  output=$(cd "$tmp" && $WORKFLOW_CMD --local --issue 1 \
    --stub-dispatch '{"iterator":"failed"}' 2>&1) || true

  labels=$(read_labels "$tmp/.agent/climpt/tmp/issues/1/meta.json")
  if echo "$labels" | grep -q '"blocked"'; then
    success "Scenario 2: PASS"
  else
    error "Scenario 2: FAIL - 'blocked' label missing: $labels"
    fail=1
  fi
  rm -rf "$tmp"

  # Scenario 3: review → revision (reviewer rejects, maxCycles=1 to stop)
  info "Scenario 3: review → revision (reviewer rejects)"
  tmp=$(setup_workdir '["review"]' 1)
  output=$(cd "$tmp" && $WORKFLOW_CMD --local --issue 1 \
    --stub-dispatch '{"reviewer":"rejected"}' 2>&1) || true

  labels=$(read_labels "$tmp/.agent/climpt/tmp/issues/1/meta.json")
  if echo "$labels" | grep -q '"implementation-gap"'; then
    success "Scenario 3: PASS"
  else
    error "Scenario 3: FAIL - 'implementation-gap' label missing: $labels"
    echo "  Labels: $labels"
    echo "  Output: $output"
    fail=1
  fi
  rm -rf "$tmp"

  if [[ $fail -ne 0 ]]; then
    error "FAIL: some workflow transition scenarios failed"
    return 1
  fi
  success "PASS: all workflow transition scenarios verified"
}

main "$@"
