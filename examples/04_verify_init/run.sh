#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLES_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${EXAMPLES_DIR}/.." && pwd)"
cd "$EXAMPLES_DIR"
source "${EXAMPLES_DIR}/common_functions.sh"

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
    error "FAIL: Config directory not found: ${CLIMPT_CONFIG_DIR}"; return 1
  fi

  if [[ -d "${CLIMPT_PROMPTS_DIR}" ]]; then
    success "Prompts directory found: ${CLIMPT_PROMPTS_DIR}"
  else
    error "FAIL: Prompts directory not found: ${CLIMPT_PROMPTS_DIR}"; return 1
  fi

  # Verify fixture deployment (test and git domains)
  local fixture_fail=0
  for cfg in test-app.yml test-user.yml git-app.yml git-user.yml; do
    if [[ ! -f "${CLIMPT_CONFIG_DIR}/${cfg}" ]]; then
      error "FAIL: fixture config not found: ${CLIMPT_CONFIG_DIR}/${cfg}"
      fixture_fail=1
    fi
  done
  for prompt in test/echo/input/f_default.md test/run/specific/f_default.md git/decide-branch/working-branch/f_default.md; do
    if [[ ! -f "${CLIMPT_PROMPTS_DIR}/${prompt}" ]]; then
      error "FAIL: fixture prompt not found: ${CLIMPT_PROMPTS_DIR}/${prompt}"
      fixture_fail=1
    fi
  done
  if [[ $fixture_fail -ne 0 ]]; then return 1; fi
  success "PASS: fixture configs and prompts deployed"

  success "PASS: init directories verified"

  # --- Reference: available init options (not executed) ---

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
