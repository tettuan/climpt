#!/usr/bin/env bash
set -euo pipefail

# 03_git_commands.sh - Git domain commands
#
# The "git" domain provides workflow automation prompts:
#   git decide-branch working-branch  - Decide branch strategy from task description
#   git find-oldest descendant-branch  - Find and merge oldest related branch
#   git list-select pr-branch          - List branches with PRs and auto-select next
#
# CLI syntax:  <c2> <c3> --config=<c1>

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

CLIMPT="deno run -A jsr:@aidevtool/climpt"

main() {
  info "=== Git Domain Commands ==="

  check_deno
  check_climpt_init

  # 1. Decide branch from task description (stdin)
  info "1. Decide branch strategy (git decide-branch working-branch)"
  show_cmd 'echo "Fix login button styling on mobile" | deno run -A jsr:@aidevtool/climpt decide-branch working-branch --config=git'
  echo "Fix login button styling on mobile" \
    | ${CLIMPT} decide-branch working-branch --config=git

  success "Git command examples complete."
}

main "$@"
