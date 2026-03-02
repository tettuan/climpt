#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLES_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${EXAMPLES_DIR}/.." && pwd)"
cd "$EXAMPLES_DIR"
source "${EXAMPLES_DIR}/common_functions.sh"

main() {
  info "=== Install Climpt (local) ==="

  # Verify Deno is available
  check_deno

  # Install Climpt globally from local repo code (-f to overwrite existing)
  info "Installing climpt globally from repo..."
  run_example deno install -g --name climpt --root .deno -f -A "$REPO_ROOT/cli.ts"

  # Add .deno/bin to PATH for verification (Deno installs binaries there)
  export PATH="${EXAMPLES_DIR}/.deno/bin:${PATH}"

  # Verify installation
  info "Verifying installation..."
  check_command climpt

  success "Climpt installed successfully."
  info "Run 'climpt init' next to initialize your project."
}

main "$@"
