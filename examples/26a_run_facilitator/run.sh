#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

main() {
  info "=== Run Facilitator Agent (project #1) ==="

  check_deno
  check_climpt_init
  check_llm_ready

  # Phase 1: Task existence
  local task_list
  task_list=$(cd "$REPO_ROOT" && deno task 2>&1) || true
  if ! echo "$task_list" | grep -q "facilitate-agent"; then
    error "FAIL: 'facilitate-agent' task not found in deno.json"; return 1
  fi
  success "PASS: facilitate-agent task exists"

  # Phase 2: Contract validation (no LLM needed)
  info "Validating agent configuration contracts..."
  local registry
  for reg_path in \
    "${REPO_ROOT}/.agent/climpt/agents/facilitator/steps_registry.json" \
    "${REPO_ROOT}/agents/facilitator/steps_registry.json"; do
    if [[ -f "$reg_path" ]]; then
      registry="$reg_path"
      break
    fi
  done
  if [[ -n "${registry:-}" ]]; then
    if ! jq empty "$registry" 2>/dev/null; then
      error "FAIL: steps_registry.json is not valid JSON"; return 1
    fi
    # Check entryStep or entryStepMapping exists
    local has_entry
    has_entry=$(jq 'has("entryStep") or has("entryStepMapping")' "$registry")
    if [[ "$has_entry" != "true" ]]; then
      error "FAIL: steps_registry.json missing entryStep/entryStepMapping"; return 1
    fi
    success "PASS: steps_registry.json has valid entry point"
  else
    warn "steps_registry.json not found (may use default config)"
  fi

  # Phase 3: LLM execution test
  info "Starting facilitator agent without --issue..."
  show_cmd deno task facilitate-agent --project 1
  local exit_code=0
  output=$( (cd "$REPO_ROOT" && deno task facilitate-agent --project 1) 2>&1) \
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

  # Exit code must be respected
  if [[ $exit_code -ne 0 ]]; then
    error "FAIL: facilitate-agent exited with code ${exit_code}"
    echo "$output" | tail -5 >&2
    return 1
  fi

  # Strict content validation: must show agent execution evidence
  if ! echo "$output" | grep -qiE "(step.*complete|facilitat.*finish|AgentResult|success|running.*step)"; then
    error "FAIL: output lacks agent execution evidence"
    echo "$output" | tail -10 >&2
    return 1
  fi
  success "PASS: facilitate-agent completed successfully"
}

main "$@"
