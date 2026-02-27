#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

main() {
  info "=== Run Facilitator Agent (no --issue) ==="

  check_deno
  check_climpt_init

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

  # Crash detection: import/startup errors are always fatal
  if echo "$output" | grep -qE "error: (Module not found|Cannot resolve|Uncaught)"; then
    error "FAIL: facilitate-agent crashed with import/startup error"
    echo "$output" | grep -E "error:" | head -5 >&2
    return 1
  fi

  if [[ -z "$output" ]]; then
    error "FAIL: facilitate-agent produced no output"; return 1
  fi

  # Content validation: output should mention agent-related terms
  if ! echo "$output" | grep -qiE "(facilitator|agent|step|running|anthropic|api)"; then
    error "FAIL: output lacks agent-related content"; return 1
  fi
  success "PASS: facilitate-agent ran without crash (exit_code=${exit_code})"
}

main "$@"
