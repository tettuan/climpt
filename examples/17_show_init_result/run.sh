#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

AGENT_NAME="plan-scout"
AGENT_DIR="${REPO_ROOT}/.agent/${AGENT_NAME}"

main() {
  info "=== Show Agent Init Result: ${AGENT_NAME} ==="

  # Verify agent exists (state from 16_init_agent)
  if [[ ! -f "${AGENT_DIR}/agent.json" ]]; then
    error ".agent/${AGENT_NAME}/agent.json not found"
    error "Run 16_init_agent/run.sh first"
    return 1
  fi

  # Show created structure
  info "Created files:"
  (cd "$REPO_ROOT" && find ".agent/${AGENT_NAME}" -type f | sort)
  echo ""

  # Show default config
  info "Default agent.json:"
  jq '.' "${AGENT_DIR}/agent.json"
  echo ""

  info "Default permissionMode:"
  jq -r '.runner.boundaries.permissionMode' "${AGENT_DIR}/agent.json"

  info "Default allowedTools:"
  jq -r '.runner.boundaries.allowedTools[]' "${AGENT_DIR}/agent.json"

  success "Agent init result displayed."
}

main "$@"
