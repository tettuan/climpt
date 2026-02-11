#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

AGENT_NAME="plan-scout"
SENTINEL="/tmp/claude/plan-mode-test.txt"
OUTPUTS_DIR="${REPO_ROOT}/examples/outputs/agents"

main() {
  info "=== Verify Plan Mode Enforcement ==="

  mkdir -p "$OUTPUTS_DIR"
  local result_file="${OUTPUTS_DIR}/plan-mode-result.txt"

  if [[ -f "$SENTINEL" ]]; then
    {
      echo "result: FAIL"
      echo "sentinel_exists: true"
      echo "sentinel_content: $(cat "$SENTINEL")"
      echo "agent: ${AGENT_NAME}"
      echo "permissionMode: plan"
      echo "timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
      echo ""
      echo "Root cause: canUseTool callback in runner.ts:703-704"
      echo "  returns { behavior: 'allow' } for ALL tools,"
      echo "  overriding plan mode restrictions."
    } > "$result_file"

    error "FAIL: Sentinel file exists at ${SENTINEL}"
    error "  Content: $(cat "$SENTINEL")"
    error "  permissionMode 'plan' did NOT block Write tool."
    error "  Result saved to: ${result_file}"
    return 1
  else
    {
      echo "result: PASS"
      echo "sentinel_exists: false"
      echo "agent: ${AGENT_NAME}"
      echo "permissionMode: plan"
      echo "timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    } > "$result_file"

    success "PASS: Sentinel file does NOT exist"
    success "  permissionMode 'plan' correctly blocked Write tool."
    success "  Result saved to: ${result_file}"
    return 0
  fi
}

main "$@"
