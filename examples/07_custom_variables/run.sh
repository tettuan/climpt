#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

main() {
  info "=== Custom Variables (--uv-*) ==="

  check_deno
  check_climpt_init

  # 1. Run specific test with --uv-target (pipe from /dev/null to avoid stdin hang)
  info "1. Pass target variable to test runner"
  show_cmd "${CLIMPT_CMD}"' run specific --config=test --uv-target=src/init_test.ts'
  output=$(${CLIMPT_CMD} run specific --config=test --uv-target=src/init_test.ts < /dev/null 2>&1) \
    || { error "FAIL: --uv-target command failed"; return 1; }
  if [[ -z "$output" ]]; then
    error "FAIL: --uv-target produced empty output"; return 1
  fi
  if ! echo "$output" | grep -qiE "(init_test|uv-target|target)"; then
    error "FAIL: --uv-target output lacks target-related content"; return 1
  fi
  success "PASS: --uv-target output contains target-related content"

  # 2. Echo with custom variable --uv-custom
  info "2. Pass custom variable via --uv-custom"
  show_cmd 'echo "hello" | '"${CLIMPT_CMD}"' echo input --config=test --uv-custom=myvalue'
  output=$(echo "hello" \
    | ${CLIMPT_CMD} echo input --config=test --uv-custom=myvalue 2>&1) \
    || { error "FAIL: echo input with --uv-custom failed"; return 1; }
  if [[ -z "$output" ]]; then
    error "FAIL: echo input produced empty output"; return 1
  fi
  if ! echo "$output" | grep -q "hello"; then
    error "FAIL: echo input output missing 'hello'"; return 1
  fi
  success "PASS: echo input with --uv-custom contains 'hello'"
}

main "$@"
