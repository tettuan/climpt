#!/usr/bin/env bash
set -euo pipefail

# 02_run_reviewer.sh - Run the reviewer agent
#
# The reviewer agent analyzes a project and provides quality feedback,
# code review suggestions, and improvement recommendations.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

main() {
  info "=== Run Reviewer Agent ==="

  check_deno
  check_climpt_init

  # Run reviewer agent on a project
  info "Starting reviewer agent for project #5..."
  run_example deno task review-agent --project 5

  success "Reviewer agent complete."
}

main "$@"
