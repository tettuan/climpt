#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

AGENT_NAME="plan-scout"
AGENT_DIR="${REPO_ROOT}/.agent/${AGENT_NAME}"

main() {
  info "=== Initialize Agent: ${AGENT_NAME} ==="

  check_deno

  # Clean previous run
  if [[ -d "$AGENT_DIR" ]]; then
    warn "Existing .agent/${AGENT_NAME}/ found, removing for clean init"
    rm -rf "$AGENT_DIR"
  fi

  # Init
  show_cmd deno task agent --init --agent "$AGENT_NAME"
  (cd "$REPO_ROOT" && deno task agent --init --agent "$AGENT_NAME")

  # Verify
  if [[ ! -f "${AGENT_DIR}/agent.json" ]]; then
    error "Agent init failed: agent.json not found"
    return 1
  fi

  success "Agent initialized: ${AGENT_DIR}/"
}

main "$@"
