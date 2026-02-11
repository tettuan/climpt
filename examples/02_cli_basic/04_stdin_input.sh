#!/usr/bin/env bash
set -euo pipefail

# 04_stdin_input.sh - STDIN piping
#
# Instead of using -f to point to a file, you can pipe text directly
# into any Climpt command via STDIN.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

main() {
  info "=== STDIN Input Examples ==="

  check_deno
  check_climpt_init

  # Pipe a description into the spec decomposer
  info "1. Pipe text into climpt-spec"
  show_cmd 'echo "Build a user authentication module" | climpt-spec to issue'
  echo "Build a user authentication module" | climpt-spec to issue

  # Pipe an error message into defect analysis
  info "2. Pipe error output into climpt-code defect"
  show_cmd 'echo "TypeError: Cannot read property id of undefined" | climpt-code defect task'
  echo "TypeError: Cannot read property id of undefined" | climpt-code defect task

  success "STDIN examples complete."
}

main "$@"
