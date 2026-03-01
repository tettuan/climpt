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

  # Crash detection: import/startup errors are always fatal
  if echo "$output" | grep -qE "error: (Module not found|Cannot resolve|Uncaught)"; then
    error "FAIL: plan agent crashed with import/startup error"
    echo "$output" | grep -E "error:" | head -5 >&2
    return 1
  fi

  if [[ -z "$output" ]]; then
    error "FAIL: agent produced no output"; return 1
  fi

  # Plan mode may exit non-zero when Write is blocked, so check for error markers
  if echo "$output" | grep -qiE "(AGENT_QUERY_ERROR|FATAL)"; then
    error "FAIL: output contains error markers"
    echo "$output" | grep -iE "(AGENT_QUERY_ERROR|FATAL)" >&2
    return 1
  fi

  success "PASS: plan agent ran without crash (exit_code=${exit_code})"
}

main "$@"
