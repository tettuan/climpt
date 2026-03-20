#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLES_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${EXAMPLES_DIR}/.." && pwd)"
cd "$EXAMPLES_DIR"
source "${EXAMPLES_DIR}/common_functions.sh"

main() {
  info "=== Workflow Batch: Queue + Orchestrator Integration ==="

  check_deno

  info "Running workflow batch tests..."
  show_cmd deno run --allow-read --allow-write --allow-env \
    "${SCRIPT_DIR}/scripts/test-workflow-batch.ts"

  output=$(deno run --allow-read --allow-write --allow-env \
    "${SCRIPT_DIR}/scripts/test-workflow-batch.ts" 2>&1) \
    || { error "FAIL: workflow batch test failed"; return 1; }
  echo "$output"

  local fail=0
  for marker in "Scenario 1:" "Scenario 2:" "Scenario 3:" "Scenario 4:" "Scenario 5:" "Summary"; do
    if ! echo "$output" | grep -q "$marker"; then
      error "FAIL: output missing '${marker}'"
      fail=1
    fi
  done

  if echo "$output" | grep -q "FAIL:"; then
    error "FAIL: workflow batch verification failed"
    fail=1
  fi

  if [[ $fail -ne 0 ]]; then return 1; fi
  success "PASS: all workflow batch scenarios verified"
}

main "$@"
