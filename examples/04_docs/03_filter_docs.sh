#!/usr/bin/env bash
set -euo pipefail

# 03_filter_docs.sh - Filter documentation by category, language, or mode
#
# Demonstrates filtering options for the docs installer.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

main() {
  info "=== Filter Documentation ==="

  check_deno

  # Filter by category
  info "1. Install only guides"
  show_cmd deno run -A jsr:@aidevtool/climpt/docs install ./docs --category=guides

  # Filter by language
  info "2. Install Japanese documentation"
  show_cmd deno run -A jsr:@aidevtool/climpt/docs install ./docs --lang=ja

  # Flatten mode: all files in a single directory
  info "3. Flatten mode (no subdirectories)"
  show_cmd deno run -A jsr:@aidevtool/climpt/docs install ./docs --mode=flatten

  # Single-file mode
  info "4. Single file output"
  show_cmd deno run -A jsr:@aidevtool/climpt/docs install ./docs --mode=single

  # Preserve original directory structure
  info "5. Preserve original structure"
  show_cmd deno run -A jsr:@aidevtool/climpt/docs install ./docs --mode=preserve

  success "See 'deno run -A jsr:@aidevtool/climpt/docs --help' for all options."
}

main "$@"
