#!/usr/bin/env bash
set -euo pipefail

# 01_install.sh - Install Climpt from JSR
#
# Installs the Climpt CLI tool globally so it is available as `climpt`
# and config-specific commands like `climpt-code`, `climpt-spec`, etc.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

main() {
  info "=== Install Climpt from JSR ==="

  # Verify Deno is available
  check_deno

  # Install Climpt globally with all permissions
  info "Installing @aidevtool/climpt/cli globally..."
  run_example deno install -g -A jsr:@aidevtool/climpt/cli

  # Verify installation
  info "Verifying installation..."
  check_command climpt

  success "Climpt installed successfully."
  info "Run 'climpt init' next to initialize your project."
}

main "$@"
