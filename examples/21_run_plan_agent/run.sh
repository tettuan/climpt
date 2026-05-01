#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLES_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${EXAMPLES_DIR}/.." && pwd)"
cd "$EXAMPLES_DIR"
source "${EXAMPLES_DIR}/common_functions.sh"

AGENT_NAME="plan-scout"
AGENT_DIR=".agent/${AGENT_NAME}"
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
  mkdir -p "$(dirname "$SENTINEL")"
  rm -f "$SENTINEL"
  info "Sentinel cleared: ${SENTINEL}"

  # Seed local subject store fixture so --local mode reads labels
  # from disk instead of `gh issue view`. Mirrors the fixture shape
  # used by examples/49-52 (DEFAULT_SUBJECT_STORE.path).
  mkdir -p .agent/climpt/tmp/issues/1/comments
  cat > .agent/climpt/tmp/issues/1/meta.json <<'META'
{
  "number": 1,
  "title": "Plan agent smoke",
  "labels": [],
  "state": "open",
  "assignees": [],
  "milestone": null
}
META
  cat > .agent/climpt/tmp/issues/1/body.md <<'BODY'
Plan agent smoke fixture (local --issue 1).
BODY

  # Show what we're testing
  info "  permissionMode: plan"
  info "  allowedTools includes Write/Edit (intentional)"
  info "  system prompt instructs: create sentinel file"
  info "  If plan mode works → Write blocked → sentinel NOT created"
  echo ""

  show_cmd deno run --allow-all "$REPO_ROOT/agents/scripts/run-agent.ts" \
    --agent "$AGENT_NAME" \
    --local \
    --issue 1 \
    --topic "Create /tmp/claude/plan-mode-test.txt"

  local exit_code=0
  output=$(deno run --allow-all "$REPO_ROOT/agents/scripts/run-agent.ts" \
    --agent "$AGENT_NAME" \
    --local \
    --issue 1 \
    --topic "Create /tmp/claude/plan-mode-test.txt" 2>&1) \
    || exit_code=$?

  if [[ -z "$output" ]]; then
    error "FAIL: agent produced no output"; return 1
  fi

  # Agent runner outputs "Agent completed: SUCCESS" or "Agent completed: FAILED"
  if echo "$output" | grep -q "Agent completed: FAILED"; then
    error "FAIL: agent reported FAILED"
    echo "$output" | tail -10 >&2
    return 1
  fi
  if ! echo "$output" | grep -q "Agent completed: SUCCESS"; then
    error "FAIL: agent did not reach completion (no SUCCESS/FAILED in output)"
    echo "$output" | tail -10 >&2
    return 1
  fi
  success "PASS: plan agent completed successfully"
}

main "$@"
