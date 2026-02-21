#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

main() {
  info "=== Agent JSON Schema ==="

  local schema_file="${REPO_ROOT}/agents/schemas/agent.schema.json"

  if [[ ! -f "$schema_file" ]]; then
    error "FAIL: schema file not found at ${schema_file}"; return 1
  fi

  info "Schema file: agents/schemas/agent.schema.json"
  show_cmd cat "$schema_file"
  cat "$schema_file"

  jq empty "$schema_file" || { error "FAIL: schema is not valid JSON"; return 1; }
  if ! grep -q '"runner"' "$schema_file"; then
    error "FAIL: schema missing 'runner' property"; return 1
  fi

  success "PASS: agent schema is valid JSON with expected properties"
}

main "$@"
