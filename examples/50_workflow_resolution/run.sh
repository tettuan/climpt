#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLES_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${EXAMPLES_DIR}/.." && pwd)"
cd "$EXAMPLES_DIR"
source "${EXAMPLES_DIR}/common_functions.sh"

WORKFLOW_CMD="deno run --allow-all ${REPO_ROOT}/agents/scripts/run-workflow.ts"
FIXTURES="${EXAMPLES_DIR}/fixtures/workflow"

# Set up a temp workdir with given labels for issue 1
setup_with_labels() {
  local labels_json="$1"
  local tmp
  tmp=$(mktemp -d)
  mkdir -p "$tmp/.agent/issues/1/comments"
  cp "$FIXTURES/workflow.json" "$tmp/.agent/workflow.json"
  cp "$FIXTURES/issues/1/body.md" "$tmp/.agent/issues/1/body.md"
  # Write meta with custom labels
  cat > "$tmp/.agent/issues/1/meta.json" <<METAEOF
{
  "number": 1,
  "title": "Test issue",
  "labels": ${labels_json},
  "state": "open",
  "assignees": [],
  "milestone": null
}
METAEOF
  echo "$tmp"
}

main() {
  info "=== Workflow Resolution: Label → Phase → Agent (CLI E2E) ==="

  check_deno

  local fail=0

  # Scenario 1: ["ready"] → finalPhase == "implementation", status == "dry-run", exit 0
  info "Scenario 1: ready label resolves to implementation phase"
  local tmp output exit_code
  tmp=$(setup_with_labels '["ready"]')
  exit_code=0
  output=$(cd "$tmp" && $WORKFLOW_CMD --local --issue 1 --dry-run 2>&1) || exit_code=$?
  if [[ "$exit_code" -ne 0 ]]; then
    error "Scenario 1: FAIL - dry-run should exit 0, got $exit_code"
    echo "$output"
    fail=1
  elif echo "$output" | grep -q '"finalPhase"' && echo "$output" | grep -q '"implementation"'; then
    if echo "$output" | grep -q '"dry-run"'; then
      success "Scenario 1: PASS"
    else
      error "Scenario 1: FAIL - status not 'dry-run'"
      echo "$output"
      fail=1
    fi
  else
    error "Scenario 1: FAIL - finalPhase not 'implementation'"
    echo "$output"
    fail=1
  fi
  rm -rf "$tmp"

  # Scenario 2: ["done"] → status == "completed" (terminal, immediate exit), exit 0
  info "Scenario 2: done label resolves as terminal"
  tmp=$(setup_with_labels '["done"]')
  exit_code=0
  output=$(cd "$tmp" && $WORKFLOW_CMD --local --issue 1 --dry-run 2>&1) || exit_code=$?
  if [[ "$exit_code" -ne 0 ]]; then
    error "Scenario 2: FAIL - terminal should exit 0, got $exit_code"
    echo "$output"
    fail=1
  elif echo "$output" | grep -q '"completed"'; then
    success "Scenario 2: PASS"
  else
    error "Scenario 2: FAIL - status not 'completed'"
    echo "$output"
    fail=1
  fi
  rm -rf "$tmp"

  # Scenario 3: ["blocked"] → status == "blocked", exit 1
  info "Scenario 3: blocked label resolves as blocking"
  tmp=$(setup_with_labels '["blocked"]')
  exit_code=0
  output=$(cd "$tmp" && $WORKFLOW_CMD --local --issue 1 --dry-run 2>&1) || exit_code=$?
  if [[ "$exit_code" -ne 1 ]]; then
    error "Scenario 3: FAIL - blocked should exit 1, got $exit_code"
    echo "$output"
    fail=1
  elif echo "$output" | grep -q '"blocked"'; then
    success "Scenario 3: PASS"
  else
    error "Scenario 3: FAIL - status not 'blocked'"
    echo "$output"
    fail=1
  fi
  rm -rf "$tmp"

  # Scenario 4: no workflow label → status == "blocked", exit 1
  info "Scenario 4: no workflow label resolves as blocked"
  tmp=$(setup_with_labels '["unrelated-label"]')
  exit_code=0
  output=$(cd "$tmp" && $WORKFLOW_CMD --local --issue 1 --dry-run 2>&1) || exit_code=$?
  if [[ "$exit_code" -ne 1 ]]; then
    error "Scenario 4: FAIL - no-label should exit 1, got $exit_code"
    echo "$output"
    fail=1
  elif echo "$output" | grep -q '"blocked"'; then
    success "Scenario 4: PASS"
  else
    error "Scenario 4: FAIL - status not 'blocked'"
    echo "$output"
    fail=1
  fi
  rm -rf "$tmp"

  # Scenario 5: ["ready", "review"] → review wins (priority 1 < 2), exit 0
  info "Scenario 5: multi-label priority resolution"
  tmp=$(setup_with_labels '["ready", "review"]')
  exit_code=0
  output=$(cd "$tmp" && $WORKFLOW_CMD --local --issue 1 --dry-run 2>&1) || exit_code=$?
  if [[ "$exit_code" -ne 0 ]]; then
    error "Scenario 5: FAIL - dry-run should exit 0, got $exit_code"
    echo "$output"
    fail=1
  elif echo "$output" | grep -q '"finalPhase"' && echo "$output" | grep -q '"review"'; then
    if echo "$output" | grep -q '"dry-run"'; then
      success "Scenario 5: PASS"
    else
      error "Scenario 5: FAIL - status not 'dry-run'"
      echo "$output"
      fail=1
    fi
  else
    error "Scenario 5: FAIL - finalPhase not 'review' (expected lowest priority number wins)"
    echo "$output"
    fail=1
  fi
  rm -rf "$tmp"

  # Scenario 6: ["ready", "done", "review"] → terminal "done" takes precedence, exit 0
  info "Scenario 6: terminal label takes precedence over actionable"
  tmp=$(setup_with_labels '["ready", "done", "review"]')
  exit_code=0
  output=$(cd "$tmp" && $WORKFLOW_CMD --local --issue 1 --dry-run 2>&1) || exit_code=$?
  if [[ "$exit_code" -ne 0 ]]; then
    error "Scenario 6: FAIL - terminal should exit 0, got $exit_code"
    echo "$output"
    fail=1
  elif echo "$output" | grep -q '"completed"' && echo "$output" | grep -q '"complete"'; then
    success "Scenario 6: PASS"
  else
    error "Scenario 6: FAIL - expected terminal completion"
    echo "$output"
    fail=1
  fi
  rm -rf "$tmp"

  if [[ $fail -ne 0 ]]; then
    error "FAIL: some workflow resolution scenarios failed"
    return 1
  fi
  success "PASS: all workflow resolution scenarios verified"
}

main "$@"
