#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLES_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${EXAMPLES_DIR}/.." && pwd)"
cd "$EXAMPLES_DIR"
source "${EXAMPLES_DIR}/common_functions.sh"

AGENT_NAME="facilitator"
AGENT_DIR=".agent/${AGENT_NAME}"
AGENT_JSON="${AGENT_DIR}/agent.json"

main() {
  info "=== Verify Agent Configuration: ${AGENT_NAME} ==="

  check_command jq

  # Verify agent.json exists
  if [[ ! -f "$AGENT_JSON" ]]; then
    error ".agent/${AGENT_NAME}/agent.json not found"
    error "Run 38-39 steps first"
    return 1
  fi

  # Verify verdict type
  local verdict_type
  verdict_type=$(jq -r '.runner.verdict.type // empty' "$AGENT_JSON")
  if [[ "$verdict_type" != "detect:structured" ]]; then
    error "FAIL: verdict.type is '${verdict_type}', expected 'detect:structured'"; return 1
  fi
  success "PASS: verdict.type = detect:structured"

  # Verify signalType
  local signal_type
  signal_type=$(jq -r '.runner.verdict.config.signalType // empty' "$AGENT_JSON")
  if [[ "$signal_type" != "facilitator_decision" ]]; then
    error "FAIL: signalType is '${signal_type}', expected 'facilitator_decision'"; return 1
  fi
  success "PASS: signalType = facilitator_decision"

  # Verify requiredFields
  local required_fields
  required_fields=$(jq -c '.runner.verdict.config.requiredFields // []' "$AGENT_JSON")
  if [[ "$required_fields" != '["recommendations","reasoning"]' ]]; then
    error "FAIL: requiredFields is ${required_fields}, expected [\"recommendations\",\"reasoning\"]"; return 1
  fi
  success "PASS: requiredFields = [recommendations, reasoning]"

  # Verify maxIterations
  local max_iter
  max_iter=$(jq '.runner.verdict.config.maxIterations' "$AGENT_JSON")
  if [[ "$max_iter" != "3" ]]; then
    error "FAIL: maxIterations is ${max_iter}, expected 3"; return 1
  fi
  success "PASS: maxIterations = 3"

  # Verify worktree disabled (CRITICAL)
  local worktree
  worktree=$(jq '.runner.execution.worktree.enabled' "$AGENT_JSON")
  if [[ "$worktree" != "false" ]]; then
    error "FAIL: worktree.enabled is ${worktree}, expected false"; return 1
  fi
  success "PASS: worktree.enabled = false"

  # Verify github disabled
  local github
  github=$(jq '.runner.integrations.github.enabled' "$AGENT_JSON")
  if [[ "$github" != "false" ]]; then
    error "FAIL: github.enabled is ${github}, expected false"; return 1
  fi
  success "PASS: github.enabled = false"

  # Verify steps_registry.json
  local registry="${AGENT_DIR}/steps_registry.json"
  if [[ ! -f "$registry" ]]; then
    error "FAIL: steps_registry.json not found"; return 1
  fi
  if ! jq empty "$registry" 2>/dev/null; then
    error "FAIL: steps_registry.json is not valid JSON"; return 1
  fi
  local has_entry
  has_entry=$(jq 'has("entryStepMapping")' "$registry")
  if [[ "$has_entry" != "true" ]]; then
    error "FAIL: steps_registry.json missing entryStepMapping"; return 1
  fi
  success "PASS: steps_registry.json has entryStepMapping"

  # Verify prompt files
  local system_md="${AGENT_DIR}/prompts/system.md"
  if [[ ! -f "$system_md" ]]; then
    error "FAIL: system.md not found"; return 1
  fi
  success "PASS: system.md exists"

  local initial_prompt="${AGENT_DIR}/prompts/steps/initial/statuscheck/f_default.md"
  if [[ ! -f "$initial_prompt" ]]; then
    error "FAIL: initial/statuscheck/f_default.md not found"; return 1
  fi
  success "PASS: initial/statuscheck/f_default.md exists"

  local closure_prompt="${AGENT_DIR}/prompts/steps/closure/facilitation/f_default.md"
  if [[ ! -f "$closure_prompt" ]]; then
    error "FAIL: closure/facilitation/f_default.md not found"; return 1
  fi
  success "PASS: closure/facilitation/f_default.md exists"

  # Verify breakdown config
  local config_dir=".agent/climpt/config"
  if [[ ! -f "${config_dir}/${AGENT_NAME}-steps-app.yml" ]]; then
    error "FAIL: ${AGENT_NAME}-steps-app.yml not found"; return 1
  fi
  if [[ ! -f "${config_dir}/${AGENT_NAME}-steps-user.yml" ]]; then
    error "FAIL: ${AGENT_NAME}-steps-user.yml not found"; return 1
  fi
  success "PASS: breakdown config files exist"

  success "PASS: ${AGENT_NAME} configuration fully verified"
}

main "$@"
