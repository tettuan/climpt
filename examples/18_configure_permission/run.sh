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
STEPS_JSON="${AGENT_DIR}/steps_registry.json"
# Plan Z source of truth for permissionMode / allowedTools.
# See agents/config/settings-loader.ts and 04_config_system.md §"Claude Agent SDK settings".
SETTINGS_FILE=".agent/climpt/config/claude.settings.climpt.agents.${AGENT_NAME}.json"

main() {
  info "=== Configure Permission Mode: ${AGENT_NAME} ==="

  check_command jq

  # Verify agent exists (state from 16)
  if [[ ! -f "$AGENT_JSON" ]]; then
    error ".agent/${AGENT_NAME}/agent.json not found"
    error "Run 16_init_agent/run.sh first"
    return 1
  fi
  if [[ ! -f "$SETTINGS_FILE" ]]; then
    error "${SETTINGS_FILE} not found"
    error "Run 16_init_agent/run.sh first"
    return 1
  fi

  # Show before
  info "Before: permissions.defaultMode (in settings file)"
  show_cmd jq '.permissions.defaultMode' "$SETTINGS_FILE"
  jq '.permissions.defaultMode' "$SETTINGS_FILE"

  # Set defaultMode to "plan" in the per-agent settings file, and seed
  # permissions.allow with Write so the plan-mode contract test (23) can
  # verify that plan mode blocks writes despite Write being on the allow-list.
  jq '.permissions.defaultMode = "plan"
    | .permissions.allow = ["Write", "Edit", "Read", "Bash"]' \
    "$SETTINGS_FILE" > "${SETTINGS_FILE}.tmp" && mv "${SETTINGS_FILE}.tmp" "$SETTINGS_FILE"

  # Limit iteration count via agent.json (verdict config — not migrated)
  jq '.runner.verdict.config.maxIterations = 3' \
    "$AGENT_JSON" > "${AGENT_JSON}.tmp" && mv "${AGENT_JSON}.tmp" "$AGENT_JSON"

  # Show after
  info "After: permissions.defaultMode (in settings file)"
  show_cmd jq '.permissions.defaultMode' "$SETTINGS_FILE"
  jq '.permissions.defaultMode' "$SETTINGS_FILE"

  info "After: permissions.allow (in settings file)"
  show_cmd jq '.permissions.allow' "$SETTINGS_FILE"
  jq '.permissions.allow' "$SETTINGS_FILE"

  success "permissions.defaultMode set to 'plan' in ${SETTINGS_FILE}"

  # --- steps_registry.json: add permissionMode to work steps ---
  if [[ ! -f "$STEPS_JSON" ]]; then
    error "${STEPS_JSON} not found"
    return 1
  fi

  info "Before: steps_registry.json work steps"
  show_cmd jq '[.steps | to_entries[] | select(.value.stepKind == "work") | {(.key): .value.permissionMode}]' "$STEPS_JSON"
  jq '[.steps | to_entries[] | select(.value.stepKind == "work") | {(.key): .value.permissionMode}]' "$STEPS_JSON"

  # Add permissionMode: "plan" to every step with stepKind == "work"
  jq '.steps |= with_entries(if .value.stepKind == "work" then .value.permissionMode = "plan" else . end)' \
    "$STEPS_JSON" > "${STEPS_JSON}.tmp" && mv "${STEPS_JSON}.tmp" "$STEPS_JSON"

  info "After: steps_registry.json work steps"
  show_cmd jq '[.steps | to_entries[] | select(.value.stepKind == "work") | {(.key): {permissionMode: .value.permissionMode}}]' "$STEPS_JSON"
  jq '[.steps | to_entries[] | select(.value.stepKind == "work") | {(.key): {permissionMode: .value.permissionMode}}]' "$STEPS_JSON"

  success "permissionMode set to 'plan' in steps_registry.json"
}

main "$@"
