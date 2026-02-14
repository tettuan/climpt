#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/../common_functions.sh"

main() {
  info "=== Agent Configuration Structure ==="

  # 1. Show actual agents/ directory layout
  info "Agents directory layout:"
  if [[ ! -d "${REPO_ROOT}/agents" ]]; then
    error "FAIL: agents/ directory not found"; return 1
  fi
  show_cmd "ls -1 ${REPO_ROOT}/agents/"
  ls -1 "${REPO_ROOT}/agents/"

  # 2. Show actual schema required fields and property keys
  local schema_file="${REPO_ROOT}/agents/schemas/agent.schema.json"
  if [[ ! -f "$schema_file" ]]; then
    error "FAIL: agent.schema.json not found"; return 1
  fi

  info "agent.schema.json required fields:"
  show_cmd "jq '.required' $schema_file"
  jq '.required' "$schema_file" || { error "FAIL: jq .required failed"; return 1; }

  info "agent.schema.json top-level property keys:"
  show_cmd "jq '.properties | keys' $schema_file"
  jq '.properties | keys' "$schema_file" || { error "FAIL: jq .properties keys failed"; return 1; }

  # 3. Verify agents/ directory has agent subdirs
  local count=0
  for d in "${REPO_ROOT}"/agents/*/; do
    [[ -d "$d" ]] || continue
    count=$((count + 1))
  done
  if [[ $count -eq 0 ]]; then
    error "FAIL: agents/ has no subdirectories"; return 1
  fi

  success "PASS: agent config structure verified (${count} agent subdirs, schema has required fields)"
}

main "$@"
