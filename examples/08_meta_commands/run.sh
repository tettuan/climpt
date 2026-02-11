#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

CLIMPT="deno run -A jsr:@aidevtool/climpt"

main() {
  info "=== Meta Domain Commands ==="

  check_deno
  check_climpt_init

  # 1. Name a C3L command from requirements
  info "1. Derive C3L command naming (meta name c3l-command)"
  show_cmd 'echo "Create a command to analyze code complexity" | deno run -A jsr:@aidevtool/climpt name c3l-command --config=meta'
  output=$(echo "Create a command to analyze code complexity" \
    | ${CLIMPT} name c3l-command --config=meta 2>&1) \
    || { error "FAIL: name c3l-command failed"; return 1; }
  if [[ -z "$output" ]]; then
    error "FAIL: name c3l-command produced empty output"; return 1
  fi
  success "PASS: name c3l-command produced non-empty output"

  # 2. Build frontmatter from a description
  info "2. Build prompt frontmatter (meta build frontmatter)"
  show_cmd 'echo "Domain: test, Action: validate, Target: schema" | deno run -A jsr:@aidevtool/climpt build frontmatter --config=meta'
  output=$(echo "Domain: test, Action: validate, Target: schema" \
    | ${CLIMPT} build frontmatter --config=meta 2>&1) \
    || { error "FAIL: build frontmatter failed"; return 1; }
  if [[ -z "$output" ]]; then
    error "FAIL: build frontmatter produced empty output"; return 1
  fi
  success "PASS: build frontmatter produced non-empty output"

  # 3. Create an instruction file
  info "3. Create instruction (meta create instruction)"
  show_cmd 'echo "An instruction that validates JSON against a schema" | deno run -A jsr:@aidevtool/climpt create instruction --config=meta'
  output=$(echo "An instruction that validates JSON against a schema" \
    | ${CLIMPT} create instruction --config=meta 2>&1) \
    || { error "FAIL: create instruction failed"; return 1; }
  if [[ -z "$output" ]]; then
    error "FAIL: create instruction produced empty output"; return 1
  fi
  success "PASS: create instruction produced non-empty output"
}

main "$@"
