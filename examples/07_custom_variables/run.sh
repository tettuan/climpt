#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

CLIMPT="deno run -A jsr:@aidevtool/climpt"

main() {
  info "=== Custom Variables (--uv-*) ==="

  check_deno
  check_climpt_init

  # 1. Run specific test with --uv-target (pipe from /dev/null to avoid stdin hang)
  info "1. Pass target variable to test runner"
  show_cmd 'deno run -A jsr:@aidevtool/climpt run specific --config=test --uv-target=src/init_test.ts'
  output=$(${CLIMPT} run specific --config=test --uv-target=src/init_test.ts < /dev/null 2>&1) \
    || { error "FAIL: --uv-target command failed"; return 1; }
  if [[ -z "$output" ]]; then
    error "FAIL: --uv-target produced empty output"; return 1
  fi
  if ! echo "$output" | grep -qiE "(init_test|uv-target|target)"; then
    error "FAIL: --uv-target output lacks target-related content"; return 1
  fi
  success "PASS: --uv-target output contains target-related content"

  # 2. Echo with custom variable to show --uv-* is forwarded
  info "2. Pass custom variable via echo test"
  show_cmd 'echo "hello" | deno run -A jsr:@aidevtool/climpt echo input --config=test'
  output=$(echo "hello" \
    | ${CLIMPT} echo input --config=test 2>&1) \
    || { error "FAIL: echo input command failed"; return 1; }
  if [[ -z "$output" ]]; then
    error "FAIL: echo input produced empty output"; return 1
  fi
  if ! echo "$output" | grep -q "hello"; then
    error "FAIL: echo input output missing 'hello'"; return 1
  fi
  success "PASS: echo input output contains 'hello'"
}

main "$@"
