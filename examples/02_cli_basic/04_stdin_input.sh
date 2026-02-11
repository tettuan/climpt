#!/usr/bin/env bash
set -euo pipefail

# 04_stdin_input.sh - STDIN piping patterns
#
# Climpt commands that accept stdin can receive input in several ways:
#   echo "text" | climpt ...        - Pipe a string
#   cat file.md | climpt ...        - Pipe a file
#   climpt ... <<'EOF' ... EOF      - Here-document
#
# CLI syntax:  <c2> <c3> --config=<c1>

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

CLIMPT="deno run -A jsr:@aidevtool/climpt"

main() {
  info "=== STDIN Input Patterns ==="

  check_deno
  check_climpt_init

  # 1. Pipe a simple string
  info "1. Pipe a string via echo"
  show_cmd 'echo "Hello from stdin" | deno run -A jsr:@aidevtool/climpt echo input --config=test'
  echo "Hello from stdin" | ${CLIMPT} echo input --config=test

  # 2. Multi-line here-document
  info "2. Multi-line input via here-document"
  show_cmd 'deno run -A jsr:@aidevtool/climpt name c3l-command --config=meta <<EOF'
  ${CLIMPT} name c3l-command --config=meta <<'EOF'
Build a feature to validate user email addresses.
Requirements:
- Check format with regex
- Verify domain exists
- Return validation result
EOF

  # 3. Pipe from a command output
  info "3. Pipe command output (git log) into a prompt"
  show_cmd 'git log --oneline -5 | deno run -A jsr:@aidevtool/climpt echo input --config=test'
  git log --oneline -5 | ${CLIMPT} echo input --config=test

  success "STDIN input examples complete."
}

main "$@"
