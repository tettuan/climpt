#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLES_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${EXAMPLES_DIR}/.." && pwd)"
cd "$EXAMPLES_DIR"
source "${EXAMPLES_DIR}/common_functions.sh"

WORKFLOW_CMD="deno run --allow-all ${REPO_ROOT}/agents/scripts/run-workflow.ts"
FIXTURES="${EXAMPLES_DIR}/fixtures/workflow"

# Set up a temp workdir with valid config and issue data
setup_workdir() {
  local tmp
  tmp=$(mktemp -d)
  mkdir -p "$tmp/.agent/climpt/tmp/issues/1/comments"
  cp "$FIXTURES/workflow.json" "$tmp/.agent/workflow.json"
  cp "$FIXTURES/issues/1/meta.json" "$tmp/.agent/climpt/tmp/issues/1/meta.json"
  cp "$FIXTURES/issues/1/body.md" "$tmp/.agent/climpt/tmp/issues/1/body.md"
  echo "$tmp"
}

main() {
  info "=== Workflow Config: Load, Defaults, Validation (CLI E2E) ==="

  check_deno

  local fail=0

  # Scenario 1: Valid config → dry-run succeeds with exit 0
  info "Scenario 1: Valid config loads successfully"
  local tmp
  tmp=$(setup_workdir)
  local output exit_code=0
  output=$(cd "$tmp" && $WORKFLOW_CMD --local --issue 1 --dry-run 2>&1) || exit_code=$?
  if [[ "$exit_code" -ne 0 ]]; then
    error "Scenario 1: FAIL - dry-run should exit 0, got $exit_code"
    echo "$output"
    fail=1
  elif echo "$output" | grep -q '"issueNumber"'; then
    success "Scenario 1: PASS"
  else
    error "Scenario 1: FAIL - output missing 'issueNumber'"
    echo "$output"
    fail=1
  fi
  rm -rf "$tmp"

  # Scenario 2: Invalid phase type → error with 'invalid type'
  info "Scenario 2: Invalid phase type rejects"
  tmp=$(mktemp -d)
  mkdir -p "$tmp/.agent"
  cp "$FIXTURES/workflow-invalid-phase.json" "$tmp/.agent/workflow.json"
  if output=$(cd "$tmp" && $WORKFLOW_CMD --local --issue 1 --dry-run 2>&1); then
    error "Scenario 2: FAIL - expected non-zero exit but got 0"
    fail=1
  else
    if echo "$output" | grep -q "invalid type"; then
      success "Scenario 2: PASS"
    else
      error "Scenario 2: FAIL - error missing 'invalid type'"
      echo "$output"
      fail=1
    fi
  fi
  rm -rf "$tmp"

  # Scenario 3: Empty labelMapping → error with 'must not be empty'
  info "Scenario 3: Empty labelMapping rejects"
  tmp=$(mktemp -d)
  mkdir -p "$tmp/.agent"
  cp "$FIXTURES/workflow-empty-labels.json" "$tmp/.agent/workflow.json"
  if output=$(cd "$tmp" && $WORKFLOW_CMD --local --issue 1 --dry-run 2>&1); then
    error "Scenario 3: FAIL - expected non-zero exit but got 0"
    fail=1
  else
    if echo "$output" | grep -q "must not be empty"; then
      success "Scenario 3: PASS"
    else
      error "Scenario 3: FAIL - error missing 'must not be empty'"
      echo "$output"
      fail=1
    fi
  fi
  rm -rf "$tmp"

  # Scenario 4: Missing workflow.json → error with 'not found'
  info "Scenario 4: Missing workflow.json rejects"
  tmp=$(mktemp -d)
  if output=$(cd "$tmp" && $WORKFLOW_CMD --local --issue 1 --dry-run 2>&1); then
    error "Scenario 4: FAIL - expected non-zero exit but got 0"
    fail=1
  else
    if echo "$output" | grep -q "not found"; then
      success "Scenario 4: PASS"
    else
      error "Scenario 4: FAIL - error missing 'not found'"
      echo "$output"
      fail=1
    fi
  fi
  rm -rf "$tmp"

  if [[ $fail -ne 0 ]]; then
    error "FAIL: some workflow config scenarios failed"
    return 1
  fi
  success "PASS: all workflow config scenarios verified"
}

main "$@"
