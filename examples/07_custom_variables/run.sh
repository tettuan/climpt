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

  # 1. Run specific test with --uv-target
  info "1. Pass target variable to test runner"
  show_cmd 'deno run -A jsr:@aidevtool/climpt run specific --config=test --uv-target=src/init_test.ts'
  output=$(${CLIMPT} run specific --config=test --uv-target=src/init_test.ts 2>&1) \
    || { error "FAIL: --uv-target command failed"; return 1; }
  if [[ -z "$output" ]]; then
    error "FAIL: --uv-target produced empty output"; return 1
  fi
  success "PASS: --uv-target produced non-empty output"

  # 2. Convert skill with --uv-skill_name
  info "2. Pass skill_name variable to convert-skill"
  show_cmd 'echo "Convert this skill" | deno run -A jsr:@aidevtool/climpt convert-skill to-plugin --config=meta --uv-skill_name=branch-management'
  output=$(echo "Convert this skill" \
    | ${CLIMPT} convert-skill to-plugin --config=meta --uv-skill_name=branch-management 2>&1) \
    || { error "FAIL: --uv-skill_name command failed"; return 1; }
  if [[ -z "$output" ]]; then
    error "FAIL: --uv-skill_name produced empty output"; return 1
  fi
  success "PASS: --uv-skill_name produced non-empty output"
}

main "$@"
