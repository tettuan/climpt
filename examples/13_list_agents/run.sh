#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLES_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${EXAMPLES_DIR}/.." && pwd)"
cd "$EXAMPLES_DIR"
source "${EXAMPLES_DIR}/common_functions.sh"

main() {
  info "=== List Available Agents ==="

  # 1. Verify agent runner entry point exists
  if [[ ! -f "$REPO_ROOT/agents/scripts/run-agent.ts" ]]; then
    error "FAIL: agents/scripts/run-agent.ts not found"; return 1
  fi
  success "PASS: agent runner script exists"

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
}

main "$@"
