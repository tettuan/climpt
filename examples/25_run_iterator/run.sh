#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

main() {
  info "=== Run Iterator Agent ==="

  check_deno
  check_climpt_init

  # Verify iterate-agent task exists in deno.json
  if ! (cd "$REPO_ROOT" && deno task 2>&1) | grep -q "iterate-agent"; then
    error "FAIL: 'iterate-agent' task not found in deno.json"; return 1
  fi
  success "PASS: iterate-agent task exists"

  # Run iterator agent targeting a specific issue
  info "Starting iterator agent for issue #123..."
  show_cmd deno task iterate-agent --issue 123
  output=$( (cd "$REPO_ROOT" && deno task iterate-agent --issue 123) 2>&1) \
    || warn "iterate-agent exited with non-zero (may be expected)"

  if [[ -z "$output" ]]; then
    error "FAIL: iterate-agent produced no output"; return 1
  fi
  success "PASS: iterate-agent produced non-empty output"
}

main "$@"
