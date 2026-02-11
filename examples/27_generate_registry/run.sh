#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

main() {
  info "=== Generate Registry ==="

  check_deno
  check_climpt_init

  # Generate the registry from prompt files and config
  info "Running registry generator..."
  run_example deno task generate-registry

  # Verify registry file
  REGISTRY="${CLIMPT_DIR}/registry.json"
  if [[ ! -f "${REGISTRY}" ]]; then
    error "FAIL: ${REGISTRY} not found"; return 1
  fi

  # Validate JSON
  if ! jq empty "${REGISTRY}" 2>/dev/null; then
    error "FAIL: ${REGISTRY} is not valid JSON"; return 1
  fi

  # Check required keys
  if [[ "$(jq 'has("version")' "${REGISTRY}")" != "true" ]]; then
    error "FAIL: registry.json missing 'version' key"; return 1
  fi
  if [[ "$(jq 'has("tools")' "${REGISTRY}")" != "true" ]]; then
    error "FAIL: registry.json missing 'tools' key"; return 1
  fi

  success "PASS: registry.json exists with valid structure"
  info "Preview (first 20 lines):"
  head -20 "${REGISTRY}"
}

main "$@"
