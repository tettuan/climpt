#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

AGENT_NAME="plan-scout"
AGENT_DIR="${REPO_ROOT}/.agent/${AGENT_NAME}"
OUTPUTS_DIR="${REPO_ROOT}/examples/outputs/agents"

main() {
  info "=== Save Agent Results ==="

  mkdir -p "$OUTPUTS_DIR"

  # Save agent logs
  local log_dir="${REPO_ROOT}/tmp/logs/agents/${AGENT_NAME}"
  if [[ -d "$log_dir" ]]; then
    mkdir -p "${OUTPUTS_DIR}/logs"
    cp -r "$log_dir" "${OUTPUTS_DIR}/logs/${AGENT_NAME}"
    success "Logs copied to ${OUTPUTS_DIR}/logs/${AGENT_NAME}/"
  else
    warn "No logs found at ${log_dir}"
  fi

  # Save agent.json snapshot for reference
  if [[ -f "${AGENT_DIR}/agent.json" ]]; then
    cp "${AGENT_DIR}/agent.json" "${OUTPUTS_DIR}/plan-scout-agent.json"
    # Verify copy
    if [[ ! -f "${OUTPUTS_DIR}/plan-scout-agent.json" ]]; then
      error "FAIL: agent config copy not found"; return 1
    fi
    success "PASS: agent config saved to ${OUTPUTS_DIR}/plan-scout-agent.json"
  else
    warn "agent.json not found (may have been cleaned already)"
  fi

  # Cleanup agent (but keep outputs)
  if [[ -d "$AGENT_DIR" ]]; then
    info "Cleaning up .agent/${AGENT_NAME}/..."
    rm -rf "$AGENT_DIR"
    rm -f "/tmp/claude/plan-mode-test.txt"
    # Verify cleanup
    if [[ -d "$AGENT_DIR" ]]; then
      error "FAIL: agent directory still exists after cleanup"; return 1
    fi
    success "PASS: agent removed, results preserved in ${OUTPUTS_DIR}/"
  fi
}

main "$@"
