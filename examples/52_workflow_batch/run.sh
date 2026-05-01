#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLES_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${EXAMPLES_DIR}/.." && pwd)"
cd "$EXAMPLES_DIR"
source "${EXAMPLES_DIR}/common_functions.sh"

WORKFLOW_CMD="deno run --allow-all ${REPO_ROOT}/agents/scripts/run-workflow.ts"
FIXTURES="${EXAMPLES_DIR}/fixtures/workflow"

# Set up a temp workdir with 3 issues: 1,2 ready + 3 done
setup_workdir() {
  local tmp
  tmp=$(mktemp -d)
  mkdir -p "$tmp/.agent/climpt/tmp/issues/"{1,2,3}"/comments"
  cp "$FIXTURES/workflow.json" "$tmp/.agent/workflow.json"

  for n in 1 2 3; do
    cp "$FIXTURES/issues/$n/meta.json" "$tmp/.agent/climpt/tmp/issues/$n/meta.json"
    cp "$FIXTURES/issues/$n/body.md" "$tmp/.agent/climpt/tmp/issues/$n/body.md"
  done

  # Copy iterator and reviewer agent bundles required by boot eager-load
  mkdir -p "$tmp/.agent/iterator" "$tmp/.agent/reviewer"
  cp "$EXAMPLES_DIR/.agent/iterator/agent.json" "$tmp/.agent/iterator/agent.json"
  cp "$EXAMPLES_DIR/.agent/iterator/steps_registry.json" "$tmp/.agent/iterator/steps_registry.json"
  cp "$EXAMPLES_DIR/.agent/reviewer/agent.json" "$tmp/.agent/reviewer/agent.json"
  cp "$EXAMPLES_DIR/.agent/reviewer/steps_registry.json" "$tmp/.agent/reviewer/steps_registry.json"

  echo "$tmp"
}

main() {
  info "=== Workflow Batch: Multi-Issue Processing (CLI E2E) ==="

  check_deno
  check_command jq

  local fail=0

  # Scenario 1: Batch with 3 issues (2 ready + 1 done)
  info "Scenario 1: Batch processes ready issues, skips terminal"
  local tmp output exit_code
  tmp=$(setup_workdir)

  exit_code=0
  output=$(cd "$tmp" && $WORKFLOW_CMD --local \
    --stub-dispatch '{"iterator":"success","reviewer":"approved"}' 2>&1) || exit_code=$?

  # Strip orchestrator banner line(s) before the JSON body so jq can parse it.
  local output_json
  output_json=$(echo "$output" | sed -n '/^{/,$p')

  # Check exit code: should be 0
  if [[ "$exit_code" -ne 0 ]]; then
    error "Scenario 1: FAIL - expected exit code 0, got $exit_code"
    echo "$output"
    fail=1
  fi

  # Check status: should be "completed"
  local batch_status
  batch_status=$(echo "$output_json" | jq -r '.status' 2>/dev/null) || batch_status="?"
  if [[ "$batch_status" != "completed" ]]; then
    error "Scenario 1: FAIL - expected status 'completed', got $batch_status"
    echo "$output"
    fail=1
  fi

  # Check processed count: should be 2
  local processed_count
  processed_count=$(echo "$output_json" | jq '.processed | length' 2>/dev/null) || processed_count="?"
  if [[ "$processed_count" != "2" ]]; then
    error "Scenario 1: FAIL - expected 2 processed, got $processed_count"
    echo "$output"
    fail=1
  fi

  # Check skipped count: should be 1
  local skipped_count
  skipped_count=$(echo "$output_json" | jq '.skipped | length' 2>/dev/null) || skipped_count="?"
  if [[ "$skipped_count" != "1" ]]; then
    error "Scenario 1: FAIL - expected 1 skipped, got $skipped_count"
    echo "$output"
    fail=1
  fi

  # Verify file system: issues 1,2 should have "done", issue 3 unchanged
  local labels1 labels2 labels3
  labels1=$(jq -c '.labels' "$tmp/.agent/climpt/tmp/issues/1/meta.json")
  labels2=$(jq -c '.labels' "$tmp/.agent/climpt/tmp/issues/2/meta.json")
  labels3=$(jq -c '.labels' "$tmp/.agent/climpt/tmp/issues/3/meta.json")

  if echo "$labels1" | grep -q '"done"' && echo "$labels2" | grep -q '"done"'; then
    : # correct
  else
    error "Scenario 1: FAIL - issues 1,2 should have 'done'"
    echo "  Issue 1 labels: $labels1"
    echo "  Issue 2 labels: $labels2"
    fail=1
  fi

  if [[ "$labels3" == '["done"]' ]]; then
    : # unchanged
  else
    error "Scenario 1: FAIL - issue 3 labels changed: $labels3"
    fail=1
  fi

  if [[ $fail -eq 0 ]]; then
    success "Scenario 1: PASS"
  fi
  rm -rf "$tmp"

  if [[ $fail -ne 0 ]]; then
    error "FAIL: some workflow batch scenarios failed"
    return 1
  fi
  success "PASS: all workflow batch scenarios verified"
}

main "$@"
