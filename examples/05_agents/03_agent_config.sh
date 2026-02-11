#!/usr/bin/env bash
set -euo pipefail

# 03_agent_config.sh - Show agent configuration structure
#
# Displays the expected directory layout and configuration files
# for Climpt agents.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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

  # Show actual agent files if they exist
  if [[ -d "agents" ]]; then
    info "Detected agents/ directory. Contents:"
    show_cmd ls -la agents/
    ls -la agents/
  fi

  success "Agent config overview complete."
}

main "$@"
