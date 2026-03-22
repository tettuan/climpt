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
  check_llm_ready

  # Require build steps (28-30) to have been run
  if [[ ! -f ".agent/${AGENT_NAME}/agent.json" ]]; then
    error ".agent/${AGENT_NAME}/agent.json not found — run build steps first"
    return 1
  fi
  success "PASS: agent.json found"

  local registry=".agent/${AGENT_NAME}/steps_registry.json"
  if [[ -f "$registry" ]]; then
    if ! jq empty "$registry" 2>/dev/null; then
      error "FAIL: steps_registry.json is not valid JSON"; return 1
    fi
    local has_entry
    has_entry=$(jq 'has("entryStep") or has("entryStepMapping")' "$registry")
    if [[ "$has_entry" != "true" ]]; then
      error "FAIL: steps_registry.json missing entryStep/entryStepMapping"; return 1
    fi
    success "PASS: steps_registry.json has valid entry point"
  else
    warn "steps_registry.json not found (may use default config)"
  fi

  # Create test fixture: a file with a known bug
  mkdir -p tmp
  cat > tmp/iterator-fixture.ts << 'FIXTURE'
/**
 * Adds two numbers and returns the sum.
 */
export function add(a: number, b: number): number {
  return a * b; // BUG: should be a + b
}
FIXTURE
  success "Test fixture created: tmp/iterator-fixture.ts"

  # Run agent from examples/ as cwd
  info "Starting iterator agent (bug fix task)..."
  show_cmd deno run --allow-all "$REPO_ROOT/agents/scripts/run-agent.ts" \
    --agent "$AGENT_NAME"

  local exit_code=0
  output=$(deno run --allow-all "$REPO_ROOT/agents/scripts/run-agent.ts" \
    --agent "$AGENT_NAME" 2>&1) \
    || exit_code=$?

  if [[ -z "$output" ]]; then
    error "FAIL: iterate-agent produced no output"; return 1
  fi

  # Agent runner outputs "Agent completed: SUCCESS" or "Agent completed: FAILED"
  if echo "$output" | grep -q "Agent completed: FAILED"; then
    error "FAIL: iterate-agent reported FAILED"
    echo "$output" | tail -10 >&2
    return 1
  fi
  if ! echo "$output" | grep -q "Agent completed: SUCCESS"; then
    error "FAIL: iterate-agent did not reach completion (no SUCCESS/FAILED in output)"
    echo "$output" | tail -10 >&2
    return 1
  fi

  # Verify the fixture was actually fixed
  if grep -q "return a + b" tmp/iterator-fixture.ts; then
    success "PASS: bug fix verified (a * b → a + b)"
  else
    warn "Agent completed but fixture was not modified as expected"
  fi

  success "PASS: iterate-agent completed successfully"
}

main "$@"
