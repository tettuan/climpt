#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

main() {
  info "=== List Available Docs ==="

  check_deno

  # List all available documentation packages
  info "Listing available documentation..."
  show_cmd ${CLIMPT_DOCS_CMD} list
  output=$(${CLIMPT_DOCS_CMD} list 2>&1) \
    || { error "FAIL: docs list command failed"; return 1; }
  if [[ -z "$output" ]]; then
    error "FAIL: docs list produced empty output"; return 1
  fi
  echo "$output"
  success "PASS: docs list produced non-empty output"

  # Content validation: output should list known doc categories
  local line_count
  line_count=$(echo "$output" | wc -l | tr -d ' ')
  if [[ "$line_count" -lt 3 ]]; then
    error "FAIL: docs list output has fewer than 3 lines (got ${line_count})"; return 1
  fi
  success "PASS: docs list output has ${line_count} lines"
}

main "$@"
