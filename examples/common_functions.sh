#!/usr/bin/env bash
# common_functions.sh - Shared functions for Climpt examples
#
# Source this file from example scripts:
#   source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common_functions.sh"

set -euo pipefail

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
CLIMPT_DIR=".agent/climpt"
CLIMPT_CONFIG_DIR="${CLIMPT_DIR}/config"
CLIMPT_PROMPTS_DIR="${CLIMPT_DIR}/prompts"

# Colors (disabled when stdout is not a terminal)
if [[ -t 1 ]]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[0;33m'
  BLUE='\033[0;34m'
  NC='\033[0m' # No Color
else
  RED='' GREEN='' YELLOW='' BLUE='' NC=''
fi

# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------
info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# Print the command before running it
show_cmd() {
  echo -e "${YELLOW}\$${NC} $*"
}

# ---------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------

# Verify that Deno is installed and meets minimum version
check_deno() {
  if ! command -v deno &>/dev/null; then
    error "Deno is not installed. See https://deno.land/#installation"
    return 1
  fi
  local version
  version="$(deno --version | head -1 | awk '{print $2}')"
  info "Deno version: ${version}"
}

# Verify that climpt init has been run (CLIMPT_DIR exists)
check_climpt_init() {
  if [[ ! -d "${CLIMPT_DIR}" ]]; then
    error "Climpt is not initialized. Run 'climpt init' first."
    error "Expected directory: ${CLIMPT_DIR}"
    return 1
  fi
  success "Climpt directory found: ${CLIMPT_DIR}"
}

# Verify a command is available on PATH
check_command() {
  local cmd="$1"
  if ! command -v "${cmd}" &>/dev/null; then
    error "Command not found: ${cmd}"
    return 1
  fi
  success "Found command: ${cmd}"
}

# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------
cleanup_temp_files() {
  local dir="${1:-.}"
  if [[ -d "${dir}/tmp" ]]; then
    rm -rf "${dir}/tmp"
    info "Removed temporary directory: ${dir}/tmp"
  fi
}

# ---------------------------------------------------------------------------
# Execution helpers
# ---------------------------------------------------------------------------

# Run a command, showing it first. Captures exit code.
run_example() {
  show_cmd "$@"
  if "$@"; then
    success "Command succeeded"
  else
    local rc=$?
    error "Command failed with exit code ${rc}"
    return ${rc}
  fi
}

export -f info success warn error show_cmd
export -f check_deno check_climpt_init check_command
export -f cleanup_temp_files run_example
