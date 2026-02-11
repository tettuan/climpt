#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
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

  # Verify mcp-config.example.json exists
  local example_config="${REPO_ROOT}/examples/mcp/mcp-config.example.json"
  if [[ ! -f "$example_config" ]]; then
    # Also check in SCRIPT_DIR
    example_config="${SCRIPT_DIR}/mcp-config.example.json"
  fi

  if [[ -f "$example_config" ]]; then
    # Validate JSON
    if ! jq empty "$example_config" 2>/dev/null; then
      error "FAIL: ${example_config} is not valid JSON"; return 1
    fi
    # Check for mcpServers key
    if [[ "$(jq 'has("mcpServers")' "$example_config")" != "true" ]]; then
      error "FAIL: mcp-config.example.json missing 'mcpServers' key"; return 1
    fi
    info "Template: ${example_config}"
    cat "$example_config"
    success "PASS: mcp-config.example.json is valid with mcpServers key"
  else
    warn "mcp-config.example.json not found (template file may have been removed)"
    success "PASS: MCP configuration guide displayed"
  fi

  info "After editing, restart Claude Desktop or Cursor to pick up changes."
}

main "$@"
