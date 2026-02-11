#!/usr/bin/env bash
set -euo pipefail

# 04_prompt_resolution.sh - Prompt file presence affects agent behavior
#
# Demonstrates how agent prompt resolution changes based on whether
# prompt files (system.md, step prompts) exist or not.
#
# Key observations:
#   - When system.md exists with {uv-*}: content comes from file, variables substituted
#   - When system.md is missing:        generic fallback template is used
#   - When step prompt file exists:      source="user" (from file)
#   - When step prompt file is missing:  source="fallback" (embedded template)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

main() {
  info "=== Prompt Resolution: File Presence Affects Agent Behavior ==="

  check_deno

  info "Running prompt resolution comparison script..."
  show_cmd deno run --allow-read --allow-write --allow-env \
    "${SCRIPT_DIR}/scripts/test-prompt-resolution.ts"

  deno run --allow-read --allow-write --allow-env \
    "${SCRIPT_DIR}/scripts/test-prompt-resolution.ts"

  success "Prompt resolution example complete."
}

main "$@"
