#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

AGENT_NAME="plan-scout"
AGENT_DIR="${REPO_ROOT}/.agent/${AGENT_NAME}"

main() {
  info "=== Verify Plan Mode Contract (no LLM) ==="

  # Verify agent exists (from steps 16-20)
  if [[ ! -f "${AGENT_DIR}/agent.json" ]]; then
    error "FAIL: .agent/${AGENT_NAME}/agent.json not found"
    error "  Run steps 16-20 first"
    return 1
  fi

  # Contract 1: permissionMode must be "plan"
  local perm_mode
  perm_mode=$(jq -r '.runner.boundaries.permissionMode' "${AGENT_DIR}/agent.json")
  if [[ "$perm_mode" != "plan" ]]; then
    error "FAIL: permissionMode is '${perm_mode}', expected 'plan'"
    return 1
  fi
  success "PASS: permissionMode is 'plan'"

  # Contract 2: allowedTools includes Write (intentional trap for plan mode)
  local has_write
  has_write=$(jq '[.runner.boundaries.allowedTools[] | select(. == "Write" or . == "write")] | length' "${AGENT_DIR}/agent.json")
  if [[ "$has_write" -lt 1 ]]; then
    error "FAIL: allowedTools does not include Write"
    error "  Plan mode test requires Write in allowedTools to verify blocking"
    return 1
  fi
  success "PASS: allowedTools includes Write (intentional for plan mode test)"

  # Contract 3: plan-scout is NOT a step flow agent (no steps_registry)
  if [[ -f "${AGENT_DIR}/steps_registry.json" ]]; then
    error "FAIL: plan-scout should not have steps_registry.json"
    error "  plan-scout is a simple agent, not a step flow agent"
    return 1
  fi
  success "PASS: no steps_registry.json (simple agent, not step flow)"

  success "All plan mode contracts verified"
}

main "$@"
