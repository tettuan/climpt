#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

main() {
  info "=== List Available Agents ==="

  # Show agents directory structure
  if [[ -d "${REPO_ROOT}/agents" ]]; then
    info "Agents directory: ${REPO_ROOT}/agents/"
    show_cmd ls -la "${REPO_ROOT}/agents/"
    ls -la "${REPO_ROOT}/agents/"

    # List agent directories (those containing agent.json or mod.ts)
    info "Agent modules:"
    for agent_dir in "${REPO_ROOT}"/agents/*/; do
      local name
      name="$(basename "$agent_dir")"
      if [[ -f "${agent_dir}/agent.json" ]] || [[ -f "${agent_dir}/mod.ts" ]]; then
        success "  ${name}/"
      fi
    done
  else
    warn "No agents/ directory found at ${REPO_ROOT}/agents/"
  fi

  # Show agent runner if available
  if [[ -f "${REPO_ROOT}/agents/scripts/run-agent.ts" ]]; then
    info "Agent runner: agents/scripts/run-agent.ts"
  fi

  success "Agent listing complete."
}

main "$@"
