#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

main() {
  info "=== Check Prerequisites ==="

  # Verify Deno is available
  check_deno

  # Check for jq (used by agent examples)
  check_command jq

  success "All prerequisites satisfied."
}

main "$@"
