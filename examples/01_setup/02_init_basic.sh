#!/usr/bin/env bash
set -euo pipefail

# 02_init_basic.sh - Initialize Climpt in the current project
#
# Creates the `.agent/climpt/` directory with default configuration,
# prompt templates, and registry files.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

main() {
  info "=== Initialize Climpt ==="

  check_deno

  # Run climpt init to scaffold the project
  info "Running climpt init..."
  run_example climpt init

  # Show what was created
  info "Created directory structure:"
  show_cmd ls -la "${CLIMPT_DIR}"
  ls -la "${CLIMPT_DIR}" 2>/dev/null || warn "Directory not found (expected: ${CLIMPT_DIR})"

  success "Initialization complete."
}

main "$@"
