#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

main() {
  info "=== StepKind Tool Policy Contract ==="

  check_deno

  info "Testing stepKind tool policy contracts..."
  show_cmd deno run --allow-read --allow-env "${SCRIPT_DIR}/scripts/test-stepkind-policy.ts"
  local output
  output=$(deno run --allow-read --allow-env \
    "${SCRIPT_DIR}/scripts/test-stepkind-policy.ts" 2>&1) \
    || { error "FAIL: stepKind policy test script failed"; echo "$output" >&2; return 1; }
  echo "$output"

  if echo "$output" | grep -q "FAIL:"; then
    error "FAIL: test reported failures"; return 1
  fi
  if ! echo "$output" | grep -q "Summary:"; then
    error "FAIL: missing Summary marker"; return 1
  fi
  success "PASS: stepKind tool policy contracts verified"
}

main "$@"
