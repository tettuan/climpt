#!/usr/bin/env bash
set -euo pipefail

# 01_decompose.sh - Decomposition commands
#
# The "to" directive breaks high-level documents into lower layers:
#   project -> issue -> task

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

main() {
  info "=== Decomposition Commands ==="

  check_deno
  check_climpt_init

  # Project-level decomposition: breaks a project spec into issues
  info "1. Decompose a project specification into issues"
  run_example climpt-code to project -f input.md -o output/

  # Issue-level decomposition: breaks an issue into tasks
  info "2. Decompose an issue into tasks"
  run_example climpt-code to task -f issue.md -o output/

  # Spec-level: convert a spec document into issues
  info "3. Convert a spec into issues"
  run_example climpt-spec to issue -f spec.md -o output/

  success "Decomposition examples complete."
}

main "$@"
