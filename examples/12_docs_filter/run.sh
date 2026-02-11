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

  # Show other filter options (display only)
  info "2. Other filter options (display only):"
  show_cmd deno run -A jsr:@aidevtool/climpt/docs install ./docs --lang=ja
  show_cmd deno run -A jsr:@aidevtool/climpt/docs install ./docs --mode=flatten
  show_cmd deno run -A jsr:@aidevtool/climpt/docs install ./docs --mode=single
  show_cmd deno run -A jsr:@aidevtool/climpt/docs install ./docs --mode=preserve

  success "PASS: filter documentation verification complete"
}

main "$@"
