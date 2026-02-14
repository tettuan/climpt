#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

source "${REPO_ROOT}/examples/common_functions.sh"

main() {
  info "=== Verify Factory Completion Paths ==="

  check_deno

  info "Running factory path validation for all completion types..."

  local output
  output="$(cd "${REPO_ROOT}" && deno run --allow-read --allow-env "${SCRIPT_DIR}/scripts/validate-factory-path.ts" 2>&1)" || {
    error "Factory path validation failed"
    echo "${output}"
    return 1
  }

  echo "${output}"

  # Check for any FAIL lines
  if echo "${output}" | grep -q "FAIL:"; then
    error "Validation reported failures"
    return 1
  fi

  # Verify summary exists
  if ! echo "${output}" | grep -q "Summary:"; then
    error "Missing Summary marker"
    return 1
  fi

  success "PASS: factory completion path verification passed"
}

main "$@"
