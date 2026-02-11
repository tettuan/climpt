#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

AGENT_NAME="plan-scout"
AGENT_DIR="${REPO_ROOT}/.agent/${AGENT_NAME}"
AGENT_JSON="${AGENT_DIR}/agent.json"

main() {
  info "=== Configure Permission Mode: ${AGENT_NAME} ==="

  check_command jq

  # Verify agent exists (state from 16)
  if [[ ! -f "$AGENT_JSON" ]]; then
    error ".agent/${AGENT_NAME}/agent.json not found"
    error "Run 16_init_agent/run.sh first"
    return 1
  fi

  # Show before
  info "Before: permissionMode"
  show_cmd jq '.behavior.permissionMode' "$AGENT_JSON"
  jq '.behavior.permissionMode' "$AGENT_JSON"

  # Set permissionMode to "plan", limit to 1 iteration
  # Keep Write/Edit in allowedTools intentionally — plan mode should block them
  jq '.behavior.permissionMode = "plan"
    | .behavior.completionConfig.maxIterations = 1' \
    "$AGENT_JSON" > "${AGENT_JSON}.tmp" && mv "${AGENT_JSON}.tmp" "$AGENT_JSON"

  # Show after
  info "After: permissionMode"
  show_cmd jq '.behavior.permissionMode' "$AGENT_JSON"
  jq '.behavior.permissionMode' "$AGENT_JSON"

  success "permissionMode set to 'plan'"
}

main "$@"
