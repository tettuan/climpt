#!/usr/bin/env bash
set -euo pipefail

# 01_run_iterator.sh - Run the iterator agent
#
# The iterator agent takes a GitHub issue and performs iterative
# decomposition and implementation planning.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

main() {
  info "=== Run Iterator Agent ==="

  check_deno
  check_climpt_init

  # Run iterator agent targeting a specific issue
  info "Starting iterator agent for issue #123..."
  run_example deno task iterate-agent --issue 123

  success "Iterator agent complete."
}

main "$@"
