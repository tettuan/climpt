#!/usr/bin/env bash
set -euo pipefail

# 02_summary.sh - Summary commands
#
# The "summary" directive organizes scattered notes and information
# into a structured document.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

main() {
  info "=== Summary Commands ==="

  check_deno
  check_climpt_init

  # Summarize project-level information
  info "1. Summarize project information"
  run_example climpt-code summary project -f input.md

  # Summarize at issue level
  info "2. Summarize issue-level notes"
  run_example climpt-code summary issue -f notes.md

  success "Summary examples complete."
}

main "$@"
