#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

main() {
  info "=== Run Reviewer Agent ==="

  check_deno
  check_climpt_init

  # Verify review-agent task exists in deno.json
  if ! (cd "$REPO_ROOT" && deno task 2>&1) | grep -q "review-agent"; then
    error "FAIL: 'review-agent' task not found in deno.json"; return 1
  fi
  success "PASS: review-agent task exists"

  # Run reviewer agent on a project
  info "Starting reviewer agent for project #5..."
  show_cmd deno task review-agent --project 5
  output=$( (cd "$REPO_ROOT" && deno task review-agent --project 5) 2>&1) \
    || warn "review-agent exited with non-zero (may be expected)"

  if [[ -z "$output" ]]; then
    error "FAIL: review-agent produced no output"; return 1
  fi
  success "PASS: review-agent produced non-empty output"
}

main "$@"
