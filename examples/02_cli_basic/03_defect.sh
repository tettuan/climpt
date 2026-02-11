#!/usr/bin/env bash
set -euo pipefail

# 03_defect.sh - Defect analysis commands
#
# The "defect" directive analyzes error logs, stack traces, or bug
# reports and produces a structured fix proposal.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

main() {
  info "=== Defect Analysis Commands ==="

  check_deno
  check_climpt_init

  # Analyze a task-level defect from an error log
  info "1. Analyze defect from error log"
  run_example climpt-code defect task -f error-log.md

  # Analyze defect at issue level
  info "2. Analyze defect at issue level"
  run_example climpt-code defect issue -f bug-report.md

  success "Defect analysis examples complete."
}

main "$@"
