#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLES_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${EXAMPLES_DIR}/.." && pwd)"
cd "$EXAMPLES_DIR"
source "${EXAMPLES_DIR}/common_functions.sh"

main() {
  info "=== Git Domain Commands ==="

  check_deno
  check_climpt_init

  # 1. Decide branch from task description (stdin)
  info "1. Decide branch strategy (git decide-branch working-branch)"
  show_cmd "echo \"Fix login button styling on mobile\" | deno run -A $REPO_ROOT/mod.ts decide-branch working-branch --config=git"
  output=$(echo "Fix login button styling on mobile" \
    | ${CLIMPT} decide-branch working-branch --config=git 2>&1) \
    || { error "FAIL: decide-branch command failed"; return 1; }
  if [[ -z "$output" ]]; then
    error "FAIL: decide-branch produced empty output"; return 1
  fi
  if ! echo "$output" | grep -qiE "(branch|fix/|feature/|bugfix/|working)"; then
    error "FAIL: decide-branch output missing branch-related content"; return 1
  fi
  success "PASS: decide-branch output contains branch-related content"
}

main "$@"
