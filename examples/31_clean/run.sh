#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

main() {
  info "=== Cleanup Example Artifacts ==="

  # Remove output directories that examples may have created
  local examples_dir="${SCRIPT_DIR}/.."
  for dir in output tmp outputs; do
    if [[ -d "${examples_dir}/${dir}" ]]; then
      info "Removing examples/${dir}/"
      rm -rf "${examples_dir}/${dir}"
      success "Removed examples/${dir}/"
    fi
  done

  # Remove docs directory created by docs examples
  if [[ -d "${examples_dir}/docs" && -f "${examples_dir}/docs/.climpt-installed" ]]; then
    info "Removing example-installed docs/"
    rm -rf "${examples_dir}/docs"
    success "Removed docs/"
  fi

  # Remove .agent directories created by agent examples
  if [[ -d "${REPO_ROOT}/.agent/plan-scout" ]]; then
    info "Removing .agent/plan-scout/"
    rm -rf "${REPO_ROOT}/.agent/plan-scout"
    success "Removed .agent/plan-scout/"
  fi

  # Remove sentinel file
  rm -f "/tmp/claude/plan-mode-test.txt"

  # Clean temp files from common_functions
  cleanup_temp_files "${examples_dir}"

  success "Cleanup complete. Example scripts are preserved."
}

main "$@"
