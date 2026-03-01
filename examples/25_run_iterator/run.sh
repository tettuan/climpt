#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLES_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${EXAMPLES_DIR}/.." && pwd)"
cd "$EXAMPLES_DIR"
source "${EXAMPLES_DIR}/common_functions.sh"

AGENT_NAME="iterator"

main() {
  info "=== Run Iterator Agent ==="

  check_deno
  check_climpt_init
  clear_claude_env

  # Verify iterate-agent task exists in deno.json
  local task_list
  task_list=$(cd "$REPO_ROOT" && deno task 2>&1) || true
  if ! echo "$task_list" | grep -q "iterate-agent"; then
    error "FAIL: 'iterate-agent' task not found in deno.json"; return 1
  fi
  success "PASS: iterate-agent task exists"

  # Init agent under examples/.agent/ if not present
  if [[ ! -d ".agent/${AGENT_NAME}" ]]; then
    info "Initializing ${AGENT_NAME} agent for E2E..."
    deno run --allow-all "$REPO_ROOT/agents/scripts/run-agent.ts" --init --agent "$AGENT_NAME"
  fi

  # Write E2E system.md (terse prompt for fast completion)
  mkdir -p ".agent/${AGENT_NAME}/prompts"
  cat > ".agent/${AGENT_NAME}/prompts/system.md" << 'PROMPT'
# Iterator Agent (E2E Pipeline Test)

This is an E2E pipeline verification run. Do NOT perform real work.

Return the structured JSON output immediately with intent "next".
Keep responses minimal. Do not use tools unless the schema requires it.
PROMPT

  # Run iterator agent targeting a synthetic issue (no API key needed)
  info "Starting iterator agent for issue #123 (synthetic pipeline test)..."
  show_cmd deno run --allow-all "$REPO_ROOT/agents/scripts/run-agent.ts" --agent iterator --issue 123
  local exit_code=0
  output=$(deno run --allow-all "$REPO_ROOT/agents/scripts/run-agent.ts" --agent iterator --issue 123 2>&1) \
    || exit_code=$?

  # STRICT: fail if non-zero exit code
  if [[ $exit_code -ne 0 ]]; then
    error "FAIL: iterate-agent exited with code ${exit_code}"
    echo "$output" | tail -20 >&2
    return 1
  fi

  if [[ -z "$output" ]]; then
    error "FAIL: iterate-agent produced no output"; return 1
  fi

  # STRICT: fail if output contains error markers
  if echo "$output" | grep -qiE "(FAILED|AGENT_QUERY_ERROR)"; then
    error "FAIL: output contains error markers"
    echo "$output" | grep -iE "(FAILED|AGENT_QUERY_ERROR)" >&2
    return 1
  fi

  success "PASS: iterate-agent ran successfully (exit_code=${exit_code})"
}

main "$@"
