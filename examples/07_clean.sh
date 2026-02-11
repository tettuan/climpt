#!/usr/bin/env bash
set -euo pipefail

# 07_clean.sh - Cleanup generated files from examples
#
# Removes temporary and generated files produced by the example scripts.
# Does NOT touch the original example scripts or existing config files.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common_functions.sh"

main() {
  info "=== Cleanup Example Artifacts ==="

  # Remove output directories that examples may have created
  for dir in output tmp; do
    if [[ -d "${dir}" ]]; then
      info "Removing ./${dir}/"
      rm -rf "${dir}"
      success "Removed ./${dir}/"
    fi
  done

  # Remove docs directory created by 04_docs examples
  if [[ -d "docs" && -f "docs/.climpt-installed" ]]; then
    info "Removing example-installed docs/"
    rm -rf "docs"
    success "Removed docs/"
  fi

  # Clean temp files from common_functions
  cleanup_temp_files "."

  success "Cleanup complete. Example scripts are preserved."
}

main "$@"
