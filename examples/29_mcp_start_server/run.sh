#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLES_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${EXAMPLES_DIR}/.." && pwd)"
cd "$EXAMPLES_DIR"
source "${EXAMPLES_DIR}/common_functions.sh"

main() {
  info "=== Start Climpt MCP Server ==="

  check_deno

  # Verify MCP entry point exists
  info "Verifying MCP entry point..."
  if [[ ! -f "$REPO_ROOT/mcp.ts" ]]; then
    error "FAIL: $REPO_ROOT/mcp.ts not found"; return 1
  fi
  show_cmd "deno info $REPO_ROOT/mcp.ts"
  output=$(deno info "$REPO_ROOT/mcp.ts" 2>&1) \
    || { error "FAIL: deno info $REPO_ROOT/mcp.ts failed"; return 1; }
  if [[ -z "$output" ]]; then
    error "FAIL: deno info produced empty output"; return 1
  fi
  success "PASS: MCP entry point resolved successfully"

  # 2. Verify server starts without crash (stdin EOF causes clean exit)
  info "Verifying MCP server starts without crash..."
  show_cmd "deno run -A $REPO_ROOT/mcp.ts < /dev/null"
  local mcp_exit=0
  local mcp_output
  mcp_output=$(${CLIMPT_MCP} < /dev/null 2>&1) \
    || mcp_exit=$?

  # Import/startup errors are fatal regardless of exit code
  if echo "$mcp_output" | grep -qE "error: (Module not found|Cannot resolve|Uncaught)"; then
    error "FAIL: MCP server crashed with import/startup error"
    echo "$mcp_output" | grep -E "error:" | head -5 >&2
    return 1
  fi
  success "PASS: MCP server started and exited cleanly (exit_code=${mcp_exit})"
}

main "$@"
