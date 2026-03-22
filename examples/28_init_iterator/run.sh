#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLES_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${EXAMPLES_DIR}/.." && pwd)"
cd "$EXAMPLES_DIR"
source "${EXAMPLES_DIR}/common_functions.sh"

AGENT_NAME="iterator"
AGENT_DIR=".agent/${AGENT_NAME}"

main() {
  info "=== Initialize Agent: ${AGENT_NAME} ==="

  check_deno

  # Clean previous run (idempotent)
  if [[ -d "$AGENT_DIR" ]]; then
    warn "Existing .agent/${AGENT_NAME}/ found, removing for clean init"
    rm -rf "$AGENT_DIR"
  fi

  # Scaffold generation
  show_cmd deno run --allow-all "$REPO_ROOT/agents/scripts/run-agent.ts" --init --agent "$AGENT_NAME"
  deno run --allow-all "$REPO_ROOT/agents/scripts/run-agent.ts" --init --agent "$AGENT_NAME"

  # Verify
  if [[ ! -f "${AGENT_DIR}/agent.json" ]]; then
    error "Agent init failed: agent.json not found"
    return 1
  fi

  success "Agent initialized: ${AGENT_DIR}/"
}

main "$@"
