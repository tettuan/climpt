#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

CLIMPT="deno run -A jsr:@aidevtool/climpt"

main() {
  info "=== STDIN Input Patterns ==="

  check_deno
  check_climpt_init

  # 1. Pipe a simple string
  info "1. Pipe a string via echo"
  show_cmd 'echo "Hello from stdin" | deno run -A jsr:@aidevtool/climpt echo input --config=test'
  output=$(echo "Hello from stdin" | ${CLIMPT} echo input --config=test 2>&1) \
    || { error "FAIL: pipe string command failed"; return 1; }
  if ! echo "$output" | grep -q "Hello from stdin"; then
    error "FAIL: output missing 'Hello from stdin'"; return 1
  fi
  success "PASS: pipe string contains expected text"

  # 2. Multi-line here-document
  info "2. Multi-line input via here-document"
  show_cmd 'deno run -A jsr:@aidevtool/climpt build frontmatter --config=meta <<EOF'
  output=$(${CLIMPT} build frontmatter --config=meta 2>&1 <<'EOF'
Build a feature to validate user email addresses.
Domain: code
Action: validate
Target: email-format
EOF
  ) || { error "FAIL: here-document command failed"; return 1; }
  if [[ -z "$output" ]]; then
    error "FAIL: here-document produced empty output"; return 1
  fi
  if ! echo "$output" | grep -q "\-\-\-"; then
    error "FAIL: here-document output missing YAML delimiter '---'"; return 1
  fi
  success "PASS: here-document produced YAML frontmatter output"

  # 3. Pipe from a command output
  info "3. Pipe command output (git log) into a prompt"
  show_cmd 'git log --oneline -5 | deno run -A jsr:@aidevtool/climpt echo input --config=test'
  output=$(git log --oneline -5 | ${CLIMPT} echo input --config=test 2>&1) \
    || { error "FAIL: git log pipe command failed"; return 1; }
  if [[ -z "$output" ]]; then
    error "FAIL: git log pipe produced empty output"; return 1
  fi
  success "PASS: git log pipe produced non-empty output"
}

main "$@"
