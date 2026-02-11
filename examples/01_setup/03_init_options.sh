#!/usr/bin/env bash
set -euo pipefail

# 03_init_options.sh - Demonstrate climpt init options
#
# Shows the available flags for customizing initialization.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

main() {
  info "=== Climpt Init Options ==="

  check_deno

  # --force: overwrite existing configuration
  info "Option: --force (overwrites existing config)"
  show_cmd climpt init --force

  # --skip-meta: skip meta-command prompts
  info "Option: --skip-meta (skip meta prompts)"
  show_cmd climpt init --skip-meta

  # --skip-registry: skip registry.json generation
  info "Option: --skip-registry (skip registry file)"
  show_cmd climpt init --skip-registry

  # --working-dir: specify a custom working directory
  info "Option: --working-dir (custom project root)"
  show_cmd climpt init --working-dir=/path/to/project

  # Combined example
  info "Combined: re-initialize without meta prompts"
  show_cmd climpt init --force --skip-meta

  success "See 'climpt init --help' for the full list."
}

main "$@"
