#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

CLIMPT="deno run -A jsr:@aidevtool/climpt"

main() {
  info "=== Git Domain Commands ==="

  check_deno
  check_climpt_init

  # 1. Decide branch from task description (stdin)
  info "1. Decide branch strategy (git decide-branch working-branch)"
  show_cmd 'echo "Fix login button styling on mobile" | deno run -A jsr:@aidevtool/climpt decide-branch working-branch --config=git'
  output=$(echo "Fix login button styling on mobile" \
    | ${CLIMPT} decide-branch working-branch --config=git 2>&1) \
    || { error "FAIL: decide-branch command failed"; return 1; }
  if [[ -z "$output" ]]; then
    error "FAIL: decide-branch produced empty output"; return 1
  fi
  success "PASS: decide-branch produced non-empty output"
}

main "$@"
