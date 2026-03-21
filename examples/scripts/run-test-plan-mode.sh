#!/usr/bin/env bash
set -euo pipefail
# Plan mode test — run from terminal, not Claude Code.
# Tests canUseTool approval (approve) and denial (deny).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

echo "=== Test 1: approve ==="
deno run --allow-all --config "${REPO_ROOT}/deno.json" "${SCRIPT_DIR}/test-plan-mode.ts" approve

echo ""
echo "=== Test 2: deny ==="
deno run --allow-all --config "${REPO_ROOT}/deno.json" "${SCRIPT_DIR}/test-plan-mode.ts" deny
