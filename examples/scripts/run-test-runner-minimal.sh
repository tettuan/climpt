#!/usr/bin/env bash
set -euo pipefail
# Minimal runner test — run from terminal, not Claude Code.
# Verifies AgentRunner completes end-to-end with a temp agent.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

deno run --allow-all --config "${REPO_ROOT}/deno.json" "${SCRIPT_DIR}/test-runner-minimal.ts"
