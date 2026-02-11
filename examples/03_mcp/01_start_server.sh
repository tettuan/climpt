#!/usr/bin/env bash
set -euo pipefail

# 01_start_server.sh - Start the Climpt MCP server
#
# The MCP (Model Context Protocol) server exposes Climpt commands
# as tools that AI assistants can invoke.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

main() {
  info "=== Start Climpt MCP Server ==="

  check_deno

  # Start the MCP server with required permissions
  info "Starting MCP server on stdio transport..."
  show_cmd deno run -A jsr:@aidevtool/climpt/mcp

  info "The server communicates over stdio (used by Claude Desktop, Cursor, etc.)."
  info "Press Ctrl+C to stop."

  deno run -A jsr:@aidevtool/climpt/mcp
}

main "$@"
