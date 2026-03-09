#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

AGENT_NAME="plan-scout"
AGENT_DIR="${REPO_ROOT}/.agent/${AGENT_NAME}"
SENTINEL="/tmp/claude/plan-mode-test.txt"

main() {
  info "=== Run Plan Agent: ${AGENT_NAME} ==="

  check_deno
  check_llm_ready

  # Verify agent exists
  if [[ ! -f "${AGENT_DIR}/agent.json" ]]; then
    error ".agent/${AGENT_NAME}/agent.json not found"
    error "Run steps 16-20 first"
    return 1
  fi

  # Clear sentinel
  rm -f "$SENTINEL"
  info "Sentinel cleared: ${SENTINEL}"

  # Show what we're testing
  info "  permissionMode: plan"
  info "  allowedTools includes Write/Edit (intentional)"
  info "  system prompt instructs: create sentinel file"
  info "  If plan mode works → Write blocked → sentinel NOT created"
  echo ""

  show_cmd deno task agent --agent "$AGENT_NAME" \
    --topic "Create /tmp/claude/plan-mode-test.txt"

  local exit_code=0
  output=$( (cd "$REPO_ROOT" && deno task agent --agent "$AGENT_NAME" \
    --topic "Create /tmp/claude/plan-mode-test.txt") 2>&1) \
    || exit_code=$?

  if [[ -z "$output" ]]; then
    error "FAIL: agent produced no output"; return 1
  fi

  # Verify LLM actually executed (not just a startup message)
  if ! echo "$output" | grep -qiE "(TASK_COMPLETE|plan.mode|permission|blocked|tool.*denied|creating|boundary)"; then
    error "FAIL: no evidence of LLM execution in output"
    error "  Output may be just a startup/error message"
    echo "$output" | head -10 >&2
    return 1
  fi
  if [[ $exit_code -ne 0 ]]; then
    error "FAIL: agent exited with code ${exit_code}"
    echo "$output" | tail -10 >&2
    return 1
  fi
  success "PASS: plan agent executed with LLM evidence (exit_code=${exit_code})"
}

main "$@"
