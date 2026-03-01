#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

main() {
  info "=== Run Reviewer Agent ==="

  check_deno
  check_climpt_init
  clear_claude_env

  # Verify review-agent task exists in deno.json
  local task_list
  task_list=$(cd "$REPO_ROOT" && deno task 2>&1) || true
  if ! echo "$task_list" | grep -q "review-agent"; then
    error "FAIL: 'review-agent' task not found in deno.json"; return 1
  fi
  success "PASS: review-agent task exists"

  # Run reviewer agent on a synthetic issue (no API key needed)
  info "Starting reviewer agent for issue #1 (synthetic pipeline test)..."
  show_cmd deno task review-agent --issue 1
  local exit_code=0
  output=$( (cd "$REPO_ROOT" && deno task review-agent --issue 1) 2>&1) \
    || exit_code=$?

  # STRICT: fail if non-zero exit code
  if [[ $exit_code -ne 0 ]]; then
    error "FAIL: review-agent exited with code ${exit_code}"
    echo "$output" | tail -20 >&2
    return 1
  fi

  if [[ -z "$output" ]]; then
    error "FAIL: review-agent produced no output"; return 1
  fi

  # STRICT: fail if output contains error markers
  if echo "$output" | grep -qiE "(FAILED|AGENT_QUERY_ERROR)"; then
    error "FAIL: output contains error markers"
    echo "$output" | grep -iE "(FAILED|AGENT_QUERY_ERROR)" >&2
    return 1
  fi

  success "PASS: review-agent ran successfully (exit_code=${exit_code})"
}

main "$@"
