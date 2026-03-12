#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

main() {
  info "=== Schema Fail-Fast Contract ==="

  check_deno

  info "Testing schema resolution contracts..."
  show_cmd deno run --allow-read --allow-write --allow-env "${SCRIPT_DIR}/scripts/test-schema-fail-fast.ts"
  local output
  output=$(deno run --allow-read --allow-write --allow-env \
    "${SCRIPT_DIR}/scripts/test-schema-fail-fast.ts" 2>&1) \
    || { error "FAIL: schema fail-fast test script failed"; echo "$output" >&2; return 1; }
  echo "$output"

  # Verify expected markers
  if ! echo "$output" | grep -q "Scenario 1:"; then
    error "FAIL: missing Scenario 1 marker"; return 1
  fi
  if ! echo "$output" | grep -q "Scenario 2:"; then
    error "FAIL: missing Scenario 2 marker"; return 1
  fi
  if echo "$output" | grep -q "FAIL:"; then
    error "FAIL: test reported failures"; return 1
  fi
  success "PASS: schema fail-fast contracts verified"
}

main "$@"
