#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLES_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${EXAMPLES_DIR}/.." && pwd)"
cd "$EXAMPLES_DIR"
source "${EXAMPLES_DIR}/common_functions.sh"

AGENT_NAME="plan-scout"
AGENT_DIR=".agent/${AGENT_NAME}"

main() {
  info "=== Show Agent Init Result: ${AGENT_NAME} ==="

  # Verify agent exists (state from 16_init_agent)
  if [[ ! -f "${AGENT_DIR}/agent.json" ]]; then
    error ".agent/${AGENT_NAME}/agent.json not found"
    error "Run 16_init_agent/run.sh first"
    return 1
  fi

  # Show created structure (cwd = examples/)
  info "Created files:"
  find ".agent/${AGENT_NAME}" -type f | sort
  echo ""

  # Show default config
  info "Default agent.json:"
  jq '.' "${AGENT_DIR}/agent.json"
  echo ""

  info "Default permissionMode:"
  jq -r '.runner.boundaries.permissionMode' "${AGENT_DIR}/agent.json"

  info "Default allowedTools:"
  jq -r '.runner.boundaries.allowedTools[]' "${AGENT_DIR}/agent.json"

  # Validate initial agent configuration structure
  local runner
  runner=$(jq '.runner' "${AGENT_DIR}/agent.json")
  if [[ "$runner" == "null" ]] || [[ -z "$runner" ]]; then
    error "FAIL: agent.json .runner is null or missing"; return 1
  fi

  local perm_mode
  perm_mode=$(jq -r '.runner.boundaries.permissionMode' "${AGENT_DIR}/agent.json")
  if [[ -z "$perm_mode" ]] || [[ "$perm_mode" == "null" ]]; then
    error "FAIL: permissionMode is empty or null"; return 1
  fi

  local tools_count
  tools_count=$(jq '.runner.boundaries.allowedTools | length' "${AGENT_DIR}/agent.json")
  if [[ "$tools_count" -lt 1 ]]; then
    error "FAIL: allowedTools is empty"; return 1
  fi
  success "PASS: initial agent config validated (permissionMode=${perm_mode}, tools=${tools_count})"
}

main "$@"
