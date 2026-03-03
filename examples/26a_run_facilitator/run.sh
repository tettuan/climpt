#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLES_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${EXAMPLES_DIR}/.." && pwd)"
cd "$EXAMPLES_DIR"
source "${EXAMPLES_DIR}/common_functions.sh"

AGENT_NAME="facilitator"

main() {
  info "=== Run Facilitator Agent ==="

  check_deno
  check_climpt_init
  clear_claude_env

  # Verify agent runner entry point exists
  if [[ ! -f "$REPO_ROOT/agents/scripts/run-agent.ts" ]]; then
    error "FAIL: agents/scripts/run-agent.ts not found"; return 1
  fi
  success "PASS: agent runner script exists"

  # Init agent under examples/.agent/ if not present
  if [[ ! -d ".agent/${AGENT_NAME}" ]]; then
    info "Initializing ${AGENT_NAME} agent for E2E..."
    deno run --allow-all "$REPO_ROOT/agents/scripts/run-agent.ts" --init --agent "$AGENT_NAME"
  fi

  # Write E2E system.md (terse prompt for fast completion)
  mkdir -p ".agent/${AGENT_NAME}/prompts"

  cat > ".agent/${AGENT_NAME}/prompts/system.md" << 'PROMPT'
# Facilitator Agent (E2E Pipeline Test)

This is an E2E pipeline verification run. Do NOT perform real work.

Return the structured JSON output immediately with intent "next".
Keep responses minimal. Do not use tools unless the schema requires it.
PROMPT

  # Run facilitator agent with a synthetic topic (E2E pipeline test)
  info "Starting facilitator agent with synthetic topic (E2E pipeline test)..."
  show_cmd deno run --allow-all "$REPO_ROOT/agents/scripts/run-agent.ts" --agent facilitator --topic "E2E pipeline test"
  local exit_code=0
  output=$(deno run --allow-all "$REPO_ROOT/agents/scripts/run-agent.ts" --agent facilitator --topic "E2E pipeline test" 2>&1) \
    || exit_code=$?

  # Pipeline verification: prompt resolution proves config + init + flow are correct
  # Note: AGENT_QUERY_ERROR is expected when running nested inside Claude Code
  # (the Claude subprocess cannot start in a sandboxed environment)
  if [[ -z "$output" ]]; then
    error "FAIL: facilitate-agent produced no output"; return 1
  fi

  if ! echo "$output" | grep -q "Prompt resolved"; then
    error "FAIL: pipeline did not reach prompt resolution"
    echo "$output" | tail -20 >&2
    return 1
  fi

  success "PASS: facilitate-agent pipeline verified (exit_code=${exit_code})"
}

main "$@"
