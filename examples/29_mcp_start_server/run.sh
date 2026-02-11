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

  # The actual server is interactive (stdio transport), so we skip starting it
  info "The server communicates over stdio (used by Claude Desktop, Cursor, etc.)."
  info "To start: deno run -A jsr:@aidevtool/climpt/mcp"
  info "Skipping interactive server start in E2E mode."
}

main "$@"
