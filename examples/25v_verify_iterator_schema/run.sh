#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

source "${REPO_ROOT}/examples/common_functions.sh"

main() {
  info "=== Verify Iterator Schema (4-Level) ==="

  check_deno

  info "Running 4-level schema validation for iterator agent..."

  local output
  output="$(cd "${REPO_ROOT}" && deno run --allow-read --allow-env "${SCRIPT_DIR}/scripts/validate-structured-output.ts" 2>&1)" || {
    error "Schema validation failed"
    echo "${output}"
    return 1
  }

  echo "${output}"

  # Verify all 4 levels reported
  for level in "Level 1:" "Level 2:" "Level 3:" "Level 4:" "Summary:"; do
    if ! echo "${output}" | grep -q "${level}"; then
      error "Missing expected marker: ${level}"
      return 1
    fi
  done

  # Check for any FAIL lines
  if echo "${output}" | grep -q "FAIL:"; then
    error "Validation reported failures"
    return 1
  fi

  success "PASS: iterator schema verification passed all 4 levels"
}

main "$@"
