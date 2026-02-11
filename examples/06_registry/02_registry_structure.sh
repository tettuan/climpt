#!/usr/bin/env bash
set -euo pipefail

# 02_registry_structure.sh - Explain the registry.json format
#
# Displays the C3L (Climpt 3-word Language) command structure
# and a sample registry entry.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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

  # Show actual registry if present
  REGISTRY="${CLIMPT_DIR}/registry.json"
  if [[ -f "${REGISTRY}" ]]; then
    info "Your current registry (${REGISTRY}):"
    show_cmd cat "${REGISTRY}"
    cat "${REGISTRY}"
  else
    warn "No registry.json found. Run 01_generate_registry.sh first."
  fi

  success "Registry structure overview complete."
}

main "$@"
