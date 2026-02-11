#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

main() {
  info "=== Initialize Climpt ==="

  check_deno

  # Run climpt init to scaffold the project
  info "Running climpt init..."
  run_example climpt init

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
