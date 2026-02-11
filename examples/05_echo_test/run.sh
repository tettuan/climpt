#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

CLIMPT="deno run -A jsr:@aidevtool/climpt"

main() {
  info "=== Echo Test (test echo input) ==="

  check_deno
  check_climpt_init

  # 1. Simple echo
  info "1. Echo a simple string"
  show_cmd 'echo "Hello, Climpt!" | deno run -A jsr:@aidevtool/climpt echo input --config=test'
  output=$(echo "Hello, Climpt!" | ${CLIMPT} echo input --config=test 2>&1) \
    || { error "FAIL: simple echo command failed"; return 1; }
  if ! echo "$output" | grep -q "Hello, Climpt!"; then
    error "FAIL: output missing 'Hello, Climpt!'"; return 1
  fi
  success "PASS: simple echo contains expected string"

  # 2. Multi-line echo
  info "2. Echo multi-line input"
  show_cmd 'printf "Line 1\nLine 2\nLine 3" | deno run -A jsr:@aidevtool/climpt echo input --config=test'
  output=$(printf "Line 1\nLine 2\nLine 3" | ${CLIMPT} echo input --config=test 2>&1) \
    || { error "FAIL: multi-line echo command failed"; return 1; }
  if ! echo "$output" | grep -q "Line 1"; then
    error "FAIL: output missing 'Line 1'"; return 1
  fi
  success "PASS: multi-line echo contains expected string"
}

main "$@"
