#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLES_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${EXAMPLES_DIR}/.." && pwd)"
cd "$EXAMPLES_DIR"

source "${EXAMPLES_DIR}/common_functions.sh"

main() {
  info "=== Step 55: Dual-Loop Log Analysis ==="

  check_deno

  info "Running dual-loop log boundary analysis..."

  local output
  output="$(cd "${REPO_ROOT}" && deno run --allow-read "${SCRIPT_DIR}/scripts/analyze-loop-boundaries.ts" "${SCRIPT_DIR}/fixtures/sample-execution.jsonl" 2>&1)" || {
    error "Dual-loop log analysis failed"
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

  success "PASS: dual-loop log boundary analysis passed"
}

main "$@"
