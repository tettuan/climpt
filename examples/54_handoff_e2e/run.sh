#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLES_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${EXAMPLES_DIR}/.." && pwd)"
cd "$EXAMPLES_DIR"

source "${EXAMPLES_DIR}/common_functions.sh"

main() {
  info "=== Step 54: Handoff E2E Data Path ==="

  check_deno

  info "Running StepContext handoff data path verification..."

  local output
  output="$(cd "${REPO_ROOT}" && deno run --allow-read --allow-env "${SCRIPT_DIR}/scripts/test-handoff-data-path.ts" 2>&1)" || {
    error "Handoff data path verification failed"
    echo "${output}"
    return 1
  }

  echo "${output}"

  # Check for any FAIL lines
  if echo "${output}" | grep -q "FAIL:"; then
    error "Verification reported failures"
    return 1
  fi

  # Verify summary exists
  if ! echo "${output}" | grep -q "Summary:"; then
    error "Missing Summary marker"
    return 1
  fi

  success "PASS: handoff E2E data path verification passed"
}

main "$@"
