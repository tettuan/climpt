#!/usr/bin/env bash
set -euo pipefail

# 01_list_docs.sh - List available documentation packages
#
# Shows all documentation packages that can be installed.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

main() {
  info "=== List Available Docs ==="

  check_deno

  # List all available documentation packages
  info "Listing available documentation..."
  run_example deno run -A jsr:@aidevtool/climpt/docs list

  success "Listing complete."
}

main "$@"
