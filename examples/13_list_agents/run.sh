#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

main() {
  info "=== List Available Agents ==="

  # 1. Verify iterate-agent/review-agent tasks exist in deno.json
  local task_list
  task_list=$(cd "$REPO_ROOT" && deno task 2>&1) || true
  for task_name in iterate-agent review-agent; do
    if ! echo "$task_list" | grep -q "$task_name"; then
      error "FAIL: '${task_name}' task not found in deno.json"; return 1
    fi
  done
  success "PASS: iterate-agent and review-agent tasks exist"

  # 2. List .agent/*/agent.json excluding climpt/
  info "User-defined agent configs (.agent/*/agent.json):"
  local found_agents=0
  for agent_json in "${REPO_ROOT}"/.agent/*/agent.json; do
    [[ -f "$agent_json" ]] || continue
    local agent_name
    agent_name="$(basename "$(dirname "$agent_json")")"
    [[ "$agent_name" == "climpt" ]] && continue
    success "  ${agent_name}/agent.json"
    found_agents=$((found_agents + 1))
  done
  if [[ $found_agents -eq 0 ]]; then
    error "FAIL: no user-defined agent configs found"; return 1
  fi
  success "PASS: found ${found_agents} user-defined agent config(s)"

  # 3. Verify agents/scripts/run-agent.ts exists
  if [[ ! -f "${REPO_ROOT}/agents/scripts/run-agent.ts" ]]; then
    error "FAIL: agents/scripts/run-agent.ts not found"; return 1
  fi
  success "PASS: agent runner script exists"
}

main "$@"
