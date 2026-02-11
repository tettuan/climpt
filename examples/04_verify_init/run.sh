#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

main() {
  info "=== Verify Init & Init Options ==="

  check_deno

  # Verify init result
  check_climpt_init

  info "Checking directory contents..."
  show_cmd ls -la "${CLIMPT_DIR}"
  ls -la "${CLIMPT_DIR}" 2>/dev/null || warn "Directory not found"

  if [[ -d "${CLIMPT_CONFIG_DIR}" ]]; then
    success "Config directory found: ${CLIMPT_CONFIG_DIR}"
  else
    warn "Config directory not found: ${CLIMPT_CONFIG_DIR}"
  fi

  if [[ -d "${CLIMPT_PROMPTS_DIR}" ]]; then
    success "Prompts directory found: ${CLIMPT_PROMPTS_DIR}"
  else
    warn "Prompts directory not found: ${CLIMPT_PROMPTS_DIR}"
  fi

  # Show available init options
  info "--- Available init options ---"

  info "Option: --force (overwrites existing config)"
  show_cmd climpt init --force

  info "Option: --skip-meta (skip meta prompts)"
  show_cmd climpt init --skip-meta

  info "Option: --skip-registry (skip registry file)"
  show_cmd climpt init --skip-registry

  info "Option: --working-dir (custom project root)"
  show_cmd climpt init --working-dir=/path/to/project

  info "Combined: re-initialize without meta prompts"
  show_cmd climpt init --force --skip-meta

  success "See 'climpt init --help' for the full list."
}

main "$@"
