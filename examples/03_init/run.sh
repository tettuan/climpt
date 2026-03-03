#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLES_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${EXAMPLES_DIR}/.." && pwd)"
cd "$EXAMPLES_DIR"
source "${EXAMPLES_DIR}/common_functions.sh"

main() {
  info "=== Initialize Climpt ==="

  check_deno

  # Run climpt init to scaffold the project (use repo code, not JSR)
  # --force allows idempotent re-runs when .agent/climpt already exists
  info "Running climpt init..."
  run_example ${CLIMPT} init --force

  # Deploy fixtures: test and git domain configs + prompts
  info "Deploying fixtures..."
  cp -r "${EXAMPLES_DIR}/fixtures/config/"* "${CLIMPT_CONFIG_DIR}/"
  cp -r "${EXAMPLES_DIR}/fixtures/prompts/"* "${CLIMPT_PROMPTS_DIR}/"
  success "Fixtures deployed to ${CLIMPT_CONFIG_DIR}/ and ${CLIMPT_PROMPTS_DIR}/"

  # Verify created directories
  local fail=0
  for dir in "$CLIMPT_DIR" "$CLIMPT_CONFIG_DIR" "$CLIMPT_PROMPTS_DIR"; do
    if [[ ! -d "$dir" ]]; then
      error "FAIL: directory not found: $dir"
      fail=1
    fi
  done

  if [[ $fail -ne 0 ]]; then return 1; fi
  success "PASS: all Climpt directories created"
}

main "$@"
