#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

main() {
  info "=== Run Iterator Agent ==="

  check_deno
  check_climpt_init
  clear_claude_env

  # Verify iterate-agent task exists in deno.json
  local task_list
  task_list=$(cd "$REPO_ROOT" && deno task 2>&1) || true
  if ! echo "$task_list" | grep -q "iterate-agent"; then
    error "FAIL: 'iterate-agent' task not found in deno.json"; return 1
  fi
  success "PASS: iterate-agent task exists"

  # Run iterator agent targeting a synthetic issue (no API key needed)
  info "Starting iterator agent for issue #123 (synthetic pipeline test)..."
  show_cmd deno task iterate-agent --issue 123
  local exit_code=0
  output=$( (cd "$REPO_ROOT" && deno task iterate-agent --issue 123) 2>&1) \
    || exit_code=$?

  # STRICT: fail if non-zero exit code
  if [[ $exit_code -ne 0 ]]; then
    error "FAIL: iterate-agent exited with code ${exit_code}"
    echo "$output" | tail -20 >&2
    return 1
  fi

  if [[ -z "$output" ]]; then
    error "FAIL: iterate-agent produced no output"; return 1
  fi

  # STRICT: fail if output contains error markers
  if echo "$output" | grep -qiE "(FAILED|AGENT_QUERY_ERROR)"; then
    error "FAIL: output contains error markers"
    echo "$output" | grep -iE "(FAILED|AGENT_QUERY_ERROR)" >&2
    return 1
  fi

  success "PASS: iterate-agent ran successfully (exit_code=${exit_code})"
}

main "$@"
