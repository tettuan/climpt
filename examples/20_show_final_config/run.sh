#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

AGENT_NAME="plan-scout"
AGENT_DIR="${REPO_ROOT}/.agent/${AGENT_NAME}"
AGENT_JSON="${AGENT_DIR}/agent.json"

main() {
  info "=== Show Final Agent Configuration: ${AGENT_NAME} ==="

  check_command jq

  # Verify agent exists
  if [[ ! -f "$AGENT_JSON" ]]; then
    error ".agent/${AGENT_NAME}/agent.json not found"
    error "Run 16-19 steps first"
    return 1
  fi

  # Verify behavior key exists and is non-null
  local behavior
  behavior=$(jq '.behavior' "$AGENT_JSON" 2>&1) \
    || { error "FAIL: jq '.behavior' failed"; return 1; }
  if [[ "$behavior" == "null" ]]; then
    error "FAIL: .behavior is null"; return 1
  fi
  info "behavior:"
  echo "$behavior"
  echo ""

  # Verify permissionMode exists
  local perm_mode
  perm_mode=$(jq -r '.behavior.permissionMode // empty' "$AGENT_JSON" 2>&1)
  if [[ -z "$perm_mode" ]]; then
    error "FAIL: .behavior.permissionMode is missing or null"; return 1
  fi
  success "PASS: behavior.permissionMode = ${perm_mode}"

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
