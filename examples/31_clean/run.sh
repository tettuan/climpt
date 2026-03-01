#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLES_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${EXAMPLES_DIR}/.." && pwd)"
cd "$EXAMPLES_DIR"
source "${EXAMPLES_DIR}/common_functions.sh"

main() {
  info "=== Cleanup Example Artifacts ==="

  # Remove output directories that examples may have created (cwd = examples/)
  for dir in output tmp outputs; do
    if [[ -d "${dir}" ]]; then
      info "Removing examples/${dir}/"
      rm -rf "${dir}"
      success "Removed examples/${dir}/"
    fi
  done

  # Remove docs directory created by docs examples
  if [[ -d "docs" && -f "docs/.climpt-installed" ]]; then
    info "Removing example-installed docs/"
    rm -rf "docs"
    success "Removed docs/"
  fi

  # Remove .agent/ directory created by agent examples (under examples/)
  if [[ -d ".agent" ]]; then
    info "Removing examples/.agent/"
    rm -rf ".agent"
    success "Removed examples/.agent/"
  fi

  # Remove sentinel file
  rm -f "/tmp/claude/plan-mode-test.txt"

  # Clean temp files from common_functions
  cleanup_temp_files "."

  success "Cleanup complete. Example scripts are preserved."
}

main "$@"
