#!/usr/bin/env bash
set -euo pipefail

# 05_custom_variables.sh - User-defined variables
#
# Pass custom key-value pairs to prompt templates using --uv-* flags.
# These are substituted as {uv-<name>} in the prompt template.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

main() {
  info "=== Custom Variables (--uv-*) ==="

  check_deno
  check_climpt_init

  # Set scope and threshold variables
  info "1. Pass scope and threshold"
  run_example climpt-code to task -f feature.md \
    --uv-scope=feature \
    --uv-threshold=80

  # Set a target language variable
  info "2. Pass target language"
  run_example climpt-code to task -f feature.md \
    --uv-lang=typescript

  # Multiple user variables combined
  info "3. Multiple variables"
  run_example climpt-spec to issue -f spec.md \
    --uv-scope=bugfix \
    --uv-priority=high \
    --uv-team=backend

  success "Custom variable examples complete."
}

main "$@"
