#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLES_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${EXAMPLES_DIR}/.." && pwd)"
cd "$EXAMPLES_DIR"
source "${EXAMPLES_DIR}/common_functions.sh"

main() {
  info "=== Prompt Resolution: File Presence Affects Agent Behavior ==="

  check_deno

  # Breakdown's TwoParamsStdinProcessor reads stdin by default.
  # This example never uses stdin, so skip it to avoid blocking.
  export BREAKDOWN_SKIP_STDIN=true

  info "Running prompt resolution comparison script..."
  show_cmd deno run --allow-read --allow-write --allow-env \
    "${SCRIPT_DIR}/scripts/test-prompt-resolution.ts"

  output=$(deno run --allow-read --allow-write --allow-env \
    "${SCRIPT_DIR}/scripts/test-prompt-resolution.ts" 2>&1) \
    || { error "FAIL: prompt resolution script failed"; return 1; }
  echo "$output"

  local fail=0
  for marker in "Scenario 1:" "Scenario 2:" "Scenario 3:" "Scenario 4:" "Summary"; do
    if ! echo "$output" | grep -q "$marker"; then
      error "FAIL: output missing '${marker}'"
      fail=1
    fi
  done

  if echo "$output" | grep -q "FAIL:"; then
    error "FAIL: prompt resolution verification failed"
    fail=1
  fi

  if [[ $fail -ne 0 ]]; then return 1; fi
  success "PASS: all prompt resolution scenarios verified"
}

main "$@"
