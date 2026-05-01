#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

AGENT_NAME="plan-scout"
AGENT_DIR="${EXAMPLES_DIR}/.agent/${AGENT_NAME}"
# Plan Z source of truth for permissionMode / allowedTools.
# Same path as agents/config/settings-loader.ts:resolveSettingsPaths().
SETTINGS_FILE="${EXAMPLES_DIR}/.agent/climpt/config/claude.settings.climpt.agents.${AGENT_NAME}.json"

main() {
  info "=== Verify Plan Mode Contract (no LLM) ==="

  # Verify agent exists (from steps 16-20)
  if [[ ! -f "${AGENT_DIR}/agent.json" ]]; then
    error "FAIL: .agent/${AGENT_NAME}/agent.json not found"
    error "  Run steps 16-20 first"
    return 1
  fi
  if [[ ! -f "${SETTINGS_FILE}" ]]; then
    error "FAIL: ${SETTINGS_FILE} not found"
    error "  Run steps 16-20 first"
    return 1
  fi

  # Contract 1: permissions.defaultMode must be "plan"
  local perm_mode
  perm_mode=$(jq -r '.permissions.defaultMode' "${SETTINGS_FILE}")
  if [[ "$perm_mode" != "plan" ]]; then
    error "FAIL: permissions.defaultMode is '${perm_mode}', expected 'plan'"
    return 1
  fi
  success "PASS: permissions.defaultMode is 'plan'"

  # Contract 2: permissions.allow includes Write (intentional trap for plan mode)
  local has_write
  has_write=$(jq '[.permissions.allow[]? | select(. == "Write" or . == "write")] | length' "${SETTINGS_FILE}")
  if [[ "$has_write" -lt 1 ]]; then
    error "FAIL: permissions.allow does not include Write"
    error "  Plan mode test requires Write in allow-list to verify blocking"
    return 1
  fi
  success "PASS: permissions.allow includes Write (intentional for plan mode test)"

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
