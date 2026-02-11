#!/usr/bin/env bash
set -euo pipefail

# 05_custom_variables.sh - User-defined variables (--uv-*)
#
# Pass custom key-value pairs to prompt templates using --uv-<name>=<value>.
# These are substituted as {uv-<name>} in the prompt template.
#
# CLI syntax:  <c2> <c3> --config=<c1> --uv-<name>=<value>

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

CLIMPT="deno run -A jsr:@aidevtool/climpt"

main() {
  info "=== Custom Variables (--uv-*) ==="

  check_deno
  check_climpt_init

  # 1. Run specific test with --uv-target
  info "1. Pass target variable to test runner"
  show_cmd 'deno run -A jsr:@aidevtool/climpt run specific --config=test --uv-target=src/init_test.ts'
  ${CLIMPT} run specific --config=test --uv-target=src/init_test.ts

  # 2. Convert skill with --uv-skill_name
  info "2. Pass skill_name variable to convert-skill"
  show_cmd 'echo "Convert this skill" | deno run -A jsr:@aidevtool/climpt convert-skill to-plugin --config=meta --uv-skill_name=branch-management'
  echo "Convert this skill" \
    | ${CLIMPT} convert-skill to-plugin --config=meta --uv-skill_name=branch-management

  success "Custom variable examples complete."
}

main "$@"
