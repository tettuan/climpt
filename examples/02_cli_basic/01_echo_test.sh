#!/usr/bin/env bash
set -euo pipefail

# 01_echo_test.sh - Simplest CLI invocation
#
# The "test echo input" command echoes stdin back to stdout.
# Use this to verify that the Climpt CLI pipeline works.
#
# CLI syntax:  <c2> <c3> --config=<c1>
#   c1 (domain) = test    -> specified via --config
#   c2 (action) = echo
#   c3 (target) = input

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

CLIMPT="deno run -A jsr:@aidevtool/climpt"

main() {
  info "=== Echo Test (test echo input) ==="

  check_deno
  check_climpt_init

  # 1. Simple echo
  info "1. Echo a simple string"
  show_cmd 'echo "Hello, Climpt!" | deno run -A jsr:@aidevtool/climpt echo input --config=test'
  echo "Hello, Climpt!" | ${CLIMPT} echo input --config=test

  # 2. Multi-line echo
  info "2. Echo multi-line input"
  show_cmd 'printf "Line 1\nLine 2\nLine 3" | deno run -A jsr:@aidevtool/climpt echo input --config=test'
  printf "Line 1\nLine 2\nLine 3" | ${CLIMPT} echo input --config=test

  success "Echo test examples complete."
}

main "$@"
