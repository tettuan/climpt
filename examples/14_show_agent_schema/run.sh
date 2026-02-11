#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

main() {
  info "=== Agent JSON Schema ==="

  local schema_file="${REPO_ROOT}/agents/schemas/agent.schema.json"

  if [[ -f "$schema_file" ]]; then
    info "Schema file: agents/schemas/agent.schema.json"
    show_cmd cat "$schema_file"
    cat "$schema_file"
  else
    warn "Schema file not found at ${schema_file}"
    info "Expected schema location: agents/schemas/agent.schema.json"
  fi

  success "Agent schema display complete."
}

main "$@"
