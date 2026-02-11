#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

main() {
  info "=== Registry Structure ==="

  info "C3L command pattern: climpt-<c1> <c2> <c3>"
  info "  c1 = domain   (code, spec, git, test, docs, meta)"
  info "  c2 = action   (to, summary, defect, create, analyze, ...)"
  info "  c3 = target   (project, issue, task, ...)"

  info ""
  info "Sample registry.json entry:"
  cat <<'SAMPLE'
{
  "version": "1.0.0",
  "description": "Climpt command registry for MCP server",
  "tools": {
    "availableConfigs": ["code", "docs", "git", "meta", "spec", "test"],
    "commands": [
      {
        "c1": "code",
        "c2": "create",
        "c3": "implementation",
        "description": "Create implementation from design documents",
        "usage": "climpt-code create implementation -f design.md -o src/",
        "options": {
          "edition": ["default"],
          "adaptation": ["default", "detailed"],
          "file": true,
          "stdin": false,
          "destination": true
        }
      }
    ]
  }
}
SAMPLE

  # Verify actual registry
  REGISTRY="${CLIMPT_DIR}/registry.json"
  if [[ ! -f "${REGISTRY}" ]]; then
    error "FAIL: ${REGISTRY} not found. Run 27_generate_registry/run.sh first."; return 1
  fi

  # Validate JSON
  if ! jq empty "${REGISTRY}" 2>/dev/null; then
    error "FAIL: ${REGISTRY} is not valid JSON"; return 1
  fi

  # Check .tools.commands length > 0
  local cmd_count
  cmd_count=$(jq '.tools.commands | length' "${REGISTRY}" 2>/dev/null) \
    || { error "FAIL: cannot read .tools.commands"; return 1; }
  if [[ "$cmd_count" -eq 0 ]]; then
    error "FAIL: .tools.commands is empty"; return 1
  fi

  # Check .tools.availableConfigs length > 0
  local config_count
  config_count=$(jq '.tools.availableConfigs | length' "${REGISTRY}" 2>/dev/null) \
    || { error "FAIL: cannot read .tools.availableConfigs"; return 1; }
  if [[ "$config_count" -eq 0 ]]; then
    error "FAIL: .tools.availableConfigs is empty"; return 1
  fi

  info "Your current registry (${REGISTRY}):"
  show_cmd cat "${REGISTRY}"
  cat "${REGISTRY}"

  success "PASS: registry has ${cmd_count} commands and ${config_count} configs"
}

main "$@"
