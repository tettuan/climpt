#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

main() {
  info "=== Agent Configuration Structure ==="

  info "Agents live under the agents/ directory:"
  cat <<'LAYOUT'
agents/
  iterator/
    agent.json          # Agent definition and metadata
    system-prompt.md    # System prompt for the agent
  reviewer/
    agent.json
    system-prompt.md
  common/
    utils.ts            # Shared utilities
  scripts/
    run-agent.ts        # Agent runner entry point
  mod.ts                # Module exports
LAYOUT

  info "agent.json schema:"
  cat <<'SCHEMA'
{
  "name": "iterator",
  "description": "Iterative decomposition agent",
  "version": "1.0.0",
  "systemPrompt": "./system-prompt.md",
  "tools": ["climpt-code", "climpt-spec"],
  "options": {
    "maxIterations": 5,
    "autoApprove": false
  }
}
SCHEMA

  # Verify agents/ directory exists
  if [[ ! -d "${REPO_ROOT}/agents" ]]; then
    error "FAIL: agents/ directory not found"; return 1
  fi

  # Count subdirectories containing agent.json or mod.ts
  local count=0
  for d in "${REPO_ROOT}"/agents/*/; do
    [[ -d "$d" ]] || continue
    if [[ -f "${d}agent.json" ]] || [[ -f "${d}mod.ts" ]]; then
      count=$((count + 1))
    fi
  done

  if [[ $count -eq 0 ]]; then
    error "FAIL: no agent subdirectories with agent.json or mod.ts found"; return 1
  fi

  info "Detected agents/ directory. Contents:"
  show_cmd ls -la "${REPO_ROOT}/agents/"
  ls -la "${REPO_ROOT}/agents/"
  success "PASS: agents/ contains ${count} configured agent(s)"
}

main "$@"
