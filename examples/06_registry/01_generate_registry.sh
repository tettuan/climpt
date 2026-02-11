#!/usr/bin/env bash
set -euo pipefail

# 01_generate_registry.sh - Generate registry.json
#
# Scans prompt directories and configuration to produce a registry
# file used by the MCP server and CLI tooling.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

main() {
  info "=== Generate Registry ==="

  check_deno
  check_climpt_init

  # Generate the registry from prompt files and config
  info "Running registry generator..."
  run_example deno task generate-registry

  # Show output location
  REGISTRY="${CLIMPT_DIR}/registry.json"
  if [[ -f "${REGISTRY}" ]]; then
    success "Registry written to ${REGISTRY}"
    info "Preview (first 20 lines):"
    head -20 "${REGISTRY}"
  else
    warn "Registry file not found at ${REGISTRY}"
  fi
}

main "$@"
