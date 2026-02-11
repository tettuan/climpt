#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

main() {
  info "=== List Available Docs ==="

  check_deno

  # List all available documentation packages
  info "Listing available documentation..."
  show_cmd deno run -A jsr:@aidevtool/climpt/docs list
  output=$(deno run -A jsr:@aidevtool/climpt/docs list 2>&1) \
    || { error "FAIL: docs list command failed"; return 1; }
  if [[ -z "$output" ]]; then
    error "FAIL: docs list produced empty output"; return 1
  fi
  echo "$output"
  success "PASS: docs list produced non-empty output"
}

main "$@"
