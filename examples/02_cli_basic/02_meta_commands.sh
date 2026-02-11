#!/usr/bin/env bash
set -euo pipefail

# 02_meta_commands.sh - Meta domain commands
#
# The "meta" domain provides tools for creating and naming Climpt
# prompts and instructions:
#   meta name c3l-command     - Derive C3L-compliant naming from requirements
#   meta build frontmatter    - Generate YAML frontmatter for prompt files
#   meta create instruction   - Create a new instruction file from description
#
# CLI syntax:  <c2> <c3> --config=<c1>

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

CLIMPT="deno run -A jsr:@aidevtool/climpt"

main() {
  info "=== Meta Domain Commands ==="

  check_deno
  check_climpt_init

  # 1. Name a C3L command from requirements
  info "1. Derive C3L command naming (meta name c3l-command)"
  show_cmd 'echo "Create a command to analyze code complexity" | deno run -A jsr:@aidevtool/climpt name c3l-command --config=meta'
  echo "Create a command to analyze code complexity" \
    | ${CLIMPT} name c3l-command --config=meta

  # 2. Build frontmatter from a description
  info "2. Build prompt frontmatter (meta build frontmatter)"
  show_cmd 'echo "Domain: test, Action: validate, Target: schema" | deno run -A jsr:@aidevtool/climpt build frontmatter --config=meta'
  echo "Domain: test, Action: validate, Target: schema" \
    | ${CLIMPT} build frontmatter --config=meta

  # 3. Create an instruction file
  info "3. Create instruction (meta create instruction)"
  show_cmd 'echo "An instruction that validates JSON against a schema" | deno run -A jsr:@aidevtool/climpt create instruction --config=meta'
  echo "An instruction that validates JSON against a schema" \
    | ${CLIMPT} create instruction --config=meta

  success "Meta command examples complete."
}

main "$@"
