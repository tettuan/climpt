#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

main() {
  info "=== Install Climpt from JSR ==="

  # Verify Deno is available
  check_deno

  # Install Climpt globally with all permissions (-f to overwrite existing)
  info "Installing @aidevtool/climpt/cli globally..."
  run_example deno install -g -f -A jsr:@aidevtool/climpt/cli

  # Add .deno/bin to PATH for verification (Deno installs binaries there)
  export PATH="${REPO_ROOT}/.deno/bin:${HOME}/.deno/bin:${PATH}"

  # Verify installation
  info "Verifying installation..."
  check_command climpt

  success "Climpt installed successfully."
  info "Run 'climpt init' next to initialize your project."
}

main "$@"
