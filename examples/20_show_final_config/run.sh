#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLES_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${EXAMPLES_DIR}/.." && pwd)"
cd "$EXAMPLES_DIR"
source "${EXAMPLES_DIR}/common_functions.sh"

AGENT_NAME="plan-scout"
AGENT_DIR=".agent/${AGENT_NAME}"
AGENT_JSON="${AGENT_DIR}/agent.json"
# Plan Z source of truth for permissionMode / allowedTools.
SETTINGS_FILE=".agent/climpt/config/claude.settings.climpt.agents.${AGENT_NAME}.json"

main() {
  info "=== Show Final Agent Configuration: ${AGENT_NAME} ==="

  check_command jq

  # Verify agent exists
  if [[ ! -f "$AGENT_JSON" ]]; then
    error ".agent/${AGENT_NAME}/agent.json not found"
    error "Run 16-19 steps first"
    return 1
  fi
  if [[ ! -f "$SETTINGS_FILE" ]]; then
    error "${SETTINGS_FILE} not found"
    error "Run 16-19 steps first"
    return 1
  fi

  # Verify runner key exists and is non-null
  local runner
  runner=$(jq '.runner' "$AGENT_JSON" 2>&1) \
    || { error "FAIL: jq '.runner' failed"; return 1; }
  if [[ "$runner" == "null" ]]; then
    error "FAIL: .runner is null"; return 1
  fi
  info "runner:"
  echo "$runner"
  echo ""

  # Show the per-agent settings file
  info "${SETTINGS_FILE}:"
  jq '.' "$SETTINGS_FILE"
  echo ""

  # Verify permissions.defaultMode exists in the settings file
  local perm_mode
  perm_mode=$(jq -r '.permissions.defaultMode // empty' "$SETTINGS_FILE" 2>&1)
  if [[ -z "$perm_mode" ]]; then
    error "FAIL: permissions.defaultMode is missing or null in ${SETTINGS_FILE}"; return 1
  fi
  success "PASS: permissions.defaultMode = ${perm_mode}"

  # Show system prompt
  local system_md="${AGENT_DIR}/prompts/system.md"
  if [[ -f "$system_md" ]]; then
    info "system.md:"
    cat "$system_md"
    echo ""
  else
    warn "system.md not found"
  fi

  success "PASS: final configuration verified"
}

main "$@"
