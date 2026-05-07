#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLES_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${EXAMPLES_DIR}/.." && pwd)"
cd "$EXAMPLES_DIR"
source "${EXAMPLES_DIR}/common_functions.sh"

AGENT_NAME="plan-scout"
AGENT_DIR=".agent/${AGENT_NAME}"
# Per-agent Claude Agent SDK settings file. Blueprint R-F4 moved
# permissionMode / allowedTools out of agent.json into this file.
# Path matches agents/config/settings-loader.ts:resolveSettingsPaths().
SETTINGS_FILE=".agent/climpt/config/claude.settings.climpt.agents.${AGENT_NAME}.json"

main() {
  info "=== Show Agent Init Result: ${AGENT_NAME} ==="

  # Verify agent exists (state from 16_init_agent)
  if [[ ! -f "${AGENT_DIR}/agent.json" ]]; then
    error ".agent/${AGENT_NAME}/agent.json not found"
    error "Run 16_init_agent/run.sh first"
    return 1
  fi
  if [[ ! -f "${SETTINGS_FILE}" ]]; then
    error "${SETTINGS_FILE} not found"
    error "Run 16_init_agent/run.sh first"
    return 1
  fi

  # Show created structure (cwd = examples/)
  info "Created files:"
  find ".agent/${AGENT_NAME}" -type f | sort
  echo ""

  # Show default agent.json
  info "Default agent.json:"
  jq '.' "${AGENT_DIR}/agent.json"
  echo ""

  # Show default Claude Agent SDK settings
  info "Default ${SETTINGS_FILE}:"
  jq '.' "${SETTINGS_FILE}"
  echo ""

  info "Default permissions.defaultMode:"
  jq -r '.permissions.defaultMode' "${SETTINGS_FILE}"

  info "Default permissions.allow:"
  jq -r '.permissions.allow[]?' "${SETTINGS_FILE}"

  # Validate initial agent configuration structure
  local runner
  runner=$(jq '.runner' "${AGENT_DIR}/agent.json")
  if [[ "$runner" == "null" ]] || [[ -z "$runner" ]]; then
    error "FAIL: agent.json .runner is null or missing"; return 1
  fi

  # Validate the per-agent settings file (Plan Z source of truth).
  local default_mode
  default_mode=$(jq -r '.permissions.defaultMode // empty' "${SETTINGS_FILE}")
  if [[ -z "$default_mode" ]]; then
    error "FAIL: permissions.defaultMode is empty or null in ${SETTINGS_FILE}"; return 1
  fi

  # `allow` must be an array (possibly empty). The init template seeds [].
  local allow_type
  allow_type=$(jq -r '.permissions.allow | type' "${SETTINGS_FILE}")
  if [[ "$allow_type" != "array" ]]; then
    error "FAIL: permissions.allow must be an array (got ${allow_type})"; return 1
  fi
  local tools_count
  tools_count=$(jq '.permissions.allow | length' "${SETTINGS_FILE}")
  success "PASS: initial agent config validated (defaultMode=${default_mode}, allow=${tools_count} tools)"
}

main "$@"
