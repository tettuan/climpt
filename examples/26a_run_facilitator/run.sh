#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

main() {
  info "=== Run Facilitator Agent (no --issue) ==="

  check_deno
  check_climpt_init
  clear_claude_env

  # Verify facilitate-agent task exists in deno.json
  local task_list
  task_list=$(cd "$REPO_ROOT" && deno task 2>&1) || true
  if ! echo "$task_list" | grep -q "facilitate-agent"; then
    error "FAIL: 'facilitate-agent' task not found in deno.json"; return 1
  fi
  success "PASS: facilitate-agent task exists"

  # Run facilitator agent WITHOUT --issue (issue.required is false)
  info "Starting facilitator agent without --issue (structuredSignal pipeline test)..."
  show_cmd deno task facilitate-agent
  local exit_code=0
  output=$( (cd "$REPO_ROOT" && deno task facilitate-agent) 2>&1) \
    || exit_code=$?

  # STRICT: fail if non-zero exit code
  if [[ $exit_code -ne 0 ]]; then
    error "FAIL: facilitate-agent exited with code ${exit_code}"
    echo "$output" | tail -20 >&2
    return 1
  fi

  if [[ -z "$output" ]]; then
    error "FAIL: facilitate-agent produced no output"; return 1
  fi

  # STRICT: fail if output contains error markers
  if echo "$output" | grep -qiE "(FAILED|AGENT_QUERY_ERROR)"; then
    error "FAIL: output contains error markers"
    echo "$output" | grep -iE "(FAILED|AGENT_QUERY_ERROR)" >&2
    return 1
  fi

  success "PASS: facilitate-agent ran successfully (exit_code=${exit_code})"
}

main "$@"
