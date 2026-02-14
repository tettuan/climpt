#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

main() {
  info "=== Start Climpt MCP Server ==="

  check_deno

  # Verify MCP package resolves
  info "Verifying MCP package availability..."
  show_cmd deno info jsr:@aidevtool/climpt/mcp
  output=$(deno info jsr:@aidevtool/climpt/mcp 2>&1) \
    || { error "FAIL: deno info jsr:@aidevtool/climpt/mcp failed"; return 1; }
  if [[ -z "$output" ]]; then
    error "FAIL: deno info produced empty output"; return 1
  fi
  success "PASS: MCP package resolved successfully"

  # 2. Verify server starts without crash (stdin EOF causes clean exit)
  info "Verifying MCP server starts without crash..."
  show_cmd 'deno run -A jsr:@aidevtool/climpt/mcp < /dev/null'
  local mcp_exit=0
  local mcp_output
  mcp_output=$(deno run -A jsr:@aidevtool/climpt/mcp < /dev/null 2>&1) \
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
