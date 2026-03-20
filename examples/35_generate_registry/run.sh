#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLES_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${EXAMPLES_DIR}/.." && pwd)"
cd "$EXAMPLES_DIR"
source "${EXAMPLES_DIR}/common_functions.sh"

main() {
  info "=== Generate Registry ==="

  check_deno
  check_climpt_init

  # Generate the registry from prompt files and config
  info "Running registry generator..."
  run_example deno run --allow-read --allow-write --allow-env "$REPO_ROOT/scripts/generate-registry.ts"

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
