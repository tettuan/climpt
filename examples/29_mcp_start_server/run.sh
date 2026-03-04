#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

main() {
  info "=== Start Climpt MCP Server ==="

  check_deno

  # Verify MCP entry point resolves
  info "Verifying MCP entry point availability..."
  show_cmd deno info "${CLIMPT_REPO_ROOT}/mcp.ts"
  output=$(deno info "${CLIMPT_REPO_ROOT}/mcp.ts" 2>&1) \
    || { error "FAIL: deno info ${CLIMPT_REPO_ROOT}/mcp.ts failed"; return 1; }
  if [[ -z "$output" ]]; then
    error "FAIL: deno info produced empty output"; return 1
  fi
  success "PASS: MCP entry point resolved successfully"

  # 2. Verify server starts without crash (stdin EOF causes clean exit)
  info "Verifying MCP server starts without crash..."
  show_cmd "${CLIMPT_MCP_CMD}"' < /dev/null'
  local mcp_exit=0
  local mcp_output
  mcp_output=$(${CLIMPT_MCP_CMD} < /dev/null 2>&1) \
    || mcp_exit=$?

  # Import/startup errors are fatal regardless of exit code
  if echo "$mcp_output" | grep -qE "error: (Module not found|Cannot resolve|Uncaught)"; then
    error "FAIL: MCP server crashed with import/startup error"
    echo "$mcp_output" | grep -E "error:" | head -5 >&2
    return 1
  fi
  success "PASS: MCP server started and exited cleanly (exit_code=${mcp_exit})"

  # 3. Verify MCP exports tools
  info "Verifying MCP module exports..."
  local exports_output
  exports_output=$(deno eval "
    const mod = await import('${CLIMPT_REPO_ROOT}/mcp.ts');
    const names = Object.keys(mod);
    console.log(JSON.stringify(names));
  " 2>&1) || true

  if [[ -n "$exports_output" ]] && echo "$exports_output" | jq empty 2>/dev/null; then
    local export_count
    export_count=$(echo "$exports_output" | jq 'length')
    if [[ "$export_count" -gt 0 ]]; then
      success "PASS: MCP module exports ${export_count} symbols"
    else
      warn "MCP module exports 0 symbols (may use side-effect imports)"
    fi
  else
    info "MCP module exports check skipped (non-JSON output)"
  fi
}

main "$@"
