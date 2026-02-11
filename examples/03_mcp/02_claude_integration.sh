#!/usr/bin/env bash
set -euo pipefail

# 02_claude_integration.sh - Configure MCP for Claude / Cursor
#
# Shows how to add the Climpt MCP server to your editor config.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

show_project_config() {
  info "Option A: Project-level config (.mcp.json in project root)"
  cat <<'CONFIG'
{
  "mcpServers": {
    "climpt": {
      "command": "deno",
      "args": [
        "run",
        "--allow-read",
        "--allow-write",
        "--allow-net",
        "--allow-env",
        "--allow-run",
        "jsr:@aidevtool/climpt/mcp"
      ]
    }
  }
}
CONFIG
}

show_global_config() {
  info "Option B: Global config (~/.claude.json)"
  cat <<'CONFIG'
{
  "mcpServers": {
    "climpt": {
      "command": "deno",
      "args": [
        "run", "-A",
        "jsr:@aidevtool/climpt/mcp"
      ]
    }
  }
}
CONFIG
}

main() {
  info "=== Claude / Cursor MCP Integration ==="

  show_project_config
  echo ""
  show_global_config

  info "See mcp-config.example.json for a ready-to-copy template."
  info "After editing, restart Claude Desktop or Cursor to pick up changes."
  success "Configuration guide complete."
}

main "$@"
