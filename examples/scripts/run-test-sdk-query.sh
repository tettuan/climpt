#!/usr/bin/env bash
set -euo pipefail
# Minimal SDK query test — run from terminal, not Claude Code.
# Verifies OAuth authentication works without ANTHROPIC_API_KEY.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

deno run --allow-all --config "${REPO_ROOT}/deno.json" "${SCRIPT_DIR}/test-sdk-query.ts"
