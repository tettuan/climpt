#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

AGENT_NAME="plan-scout"
AGENT_DIR="${EXAMPLES_DIR}/.agent/${AGENT_NAME}"

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

  # Contract 3: plan-scout must NOT be a step flow agent
  # The runner determines step flow via hasFlowRoutingSupport(), which checks
  # for structuredGate in steps_registry.json steps. A freshly --init'd agent
  # has a template registry without structuredGate — that is expected.
  if [[ -f "${AGENT_DIR}/steps_registry.json" ]]; then
    local gate_count
    gate_count=$(jq '[.steps // {} | to_entries[] | select(.value.structuredGate != null)] | length' "${AGENT_DIR}/steps_registry.json")
    if [[ "$gate_count" -gt 0 ]]; then
      error "FAIL: plan-scout has ${gate_count} step(s) with structuredGate"
      error "  plan-scout must be a simple agent for plan mode testing"
      error "  See: agents/common/validation-types.ts hasFlowRoutingSupport()"
      return 1
    fi
  fi
  success "PASS: no structuredGate in steps (simple agent, not step flow)"

  success "All plan mode contracts verified"
}

main "$@"
