#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

DOCS_DIR="./docs"

main() {
  info "=== Install Documentation ==="

  check_deno

  # Install docs into the ./docs directory
  info "Installing documentation to ${DOCS_DIR}..."
  run_example deno run -A jsr:@aidevtool/climpt/docs install "${DOCS_DIR}"

  # Verify DOCS_DIR exists
  if [[ ! -d "${DOCS_DIR}" ]]; then
    error "FAIL: ${DOCS_DIR} directory not created"; return 1
  fi

  # Verify files were installed
  local file_count
  file_count=$(find "${DOCS_DIR}" -type f | wc -l | tr -d ' ')
  if [[ "$file_count" -eq 0 ]]; then
    error "FAIL: ${DOCS_DIR} contains no files"; return 1
  fi
  success "PASS: ${DOCS_DIR} exists with ${file_count} files"
}

main "$@"
