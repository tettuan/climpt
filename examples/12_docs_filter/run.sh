#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

main() {
  info "=== Filter Documentation ==="

  check_deno

  # Use a temporary directory for actual verification
  local tmpdir
  tmpdir=$(mktemp -d)
  trap "rm -rf '$tmpdir'" EXIT

  # Filter by category - actually run and verify
  info "1. Install only guides (with verification)"
  show_cmd "deno run -A jsr:@aidevtool/climpt/docs install ${tmpdir} --category=guides"
  deno run -A jsr:@aidevtool/climpt/docs install "$tmpdir" --category=guides 2>&1 \
    || { error "FAIL: docs install --category=guides failed"; return 1; }

  local file_count
  file_count=$(find "$tmpdir" -type f | wc -l | tr -d ' ')
  if [[ "$file_count" -eq 0 ]]; then
    error "FAIL: --category=guides produced no files"; return 1
  fi
  success "PASS: --category=guides installed ${file_count} files"

  # 2. Filter by language
  info "2. Install docs with --lang=ja"
  local tmpdir_lang
  tmpdir_lang=$(mktemp -d)
  show_cmd "deno run -A jsr:@aidevtool/climpt/docs install ${tmpdir_lang} --lang=ja"
  deno run -A jsr:@aidevtool/climpt/docs install "$tmpdir_lang" --lang=ja 2>&1 \
    || { error "FAIL: docs install --lang=ja failed"; rm -rf "$tmpdir_lang"; return 1; }
  local lang_count
  lang_count=$(find "$tmpdir_lang" -type f | wc -l | tr -d ' ')
  rm -rf "$tmpdir_lang"
  if [[ "$lang_count" -eq 0 ]]; then
    error "FAIL: --lang=ja produced no files"; return 1
  fi
  success "PASS: --lang=ja installed ${lang_count} files"

  # 3. Install docs with --mode=flatten
  info "3. Install docs with --mode=flatten"
  local tmpdir_flatten
  tmpdir_flatten=$(mktemp -d)
  show_cmd "deno run -A jsr:@aidevtool/climpt/docs install ${tmpdir_flatten} --mode=flatten"
  deno run -A jsr:@aidevtool/climpt/docs install "$tmpdir_flatten" --mode=flatten 2>&1 \
    || { error "FAIL: docs install --mode=flatten failed"; rm -rf "$tmpdir_flatten"; return 1; }
  local flatten_count
  flatten_count=$(find "$tmpdir_flatten" -type f | wc -l | tr -d ' ')
  rm -rf "$tmpdir_flatten"
  if [[ "$flatten_count" -eq 0 ]]; then
    error "FAIL: --mode=flatten produced no files"; return 1
  fi
  success "PASS: --mode=flatten installed ${flatten_count} files"

  # 4. Install docs with --mode=single
  info "4. Install docs with --mode=single"
  local tmpdir_single
  tmpdir_single=$(mktemp -d)
  show_cmd "deno run -A jsr:@aidevtool/climpt/docs install ${tmpdir_single} --mode=single"
  deno run -A jsr:@aidevtool/climpt/docs install "$tmpdir_single" --mode=single 2>&1 \
    || { error "FAIL: docs install --mode=single failed"; rm -rf "$tmpdir_single"; return 1; }
  local single_count
  single_count=$(find "$tmpdir_single" -type f | wc -l | tr -d ' ')
  rm -rf "$tmpdir_single"
  if [[ "$single_count" -eq 0 ]]; then
    error "FAIL: --mode=single produced no files"; return 1
  fi
  success "PASS: --mode=single installed ${single_count} files"

  success "PASS: all doc filter modes verified"
}

main "$@"
