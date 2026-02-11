#!/usr/bin/env bash
set -euo pipefail

# 02_install_docs.sh - Install documentation files
#
# Downloads and installs Climpt documentation into a local directory.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

DOCS_DIR="./docs"

main() {
  info "=== Install Documentation ==="

  check_deno

  # Install docs into the ./docs directory
  info "Installing documentation to ${DOCS_DIR}..."
  run_example deno run -A jsr:@aidevtool/climpt/docs install "${DOCS_DIR}"

  # Show installed files
  info "Installed files:"
  show_cmd ls -la "${DOCS_DIR}"
  ls -la "${DOCS_DIR}" 2>/dev/null || warn "Directory not created (may require network)"

  success "Documentation installed."
}

main "$@"
