#!/usr/bin/env bash
# common_functions.sh - Shared functions for Climpt examples
#
# Source this file from example scripts:
#   source "${EXAMPLES_DIR}/common_functions.sh"

set -euo pipefail

# ---------------------------------------------------------------------------
# Directory constants — all examples run with cwd = examples/
# ---------------------------------------------------------------------------
EXAMPLES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${EXAMPLES_DIR}/.." && pwd)"

CLIMPT_DIR=".agent/climpt"
CLIMPT_CONFIG_DIR="${CLIMPT_DIR}/config"
CLIMPT_PROMPTS_DIR="${CLIMPT_DIR}/prompts"

# Detect repo root (common_functions.sh is at examples/common_functions.sh)
CLIMPT_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Local workspace commands (run local code, not JSR published versions)
CLIMPT_CMD="deno run -A ${CLIMPT_REPO_ROOT}/cli.ts"
CLIMPT_DOCS_CMD="deno run -A ${CLIMPT_REPO_ROOT}/docs.ts"
CLIMPT_MCP_CMD="deno run -A ${CLIMPT_REPO_ROOT}/mcp.ts"

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

# Verify LLM authentication is available (required for agent examples)
check_llm_ready() {
  if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
    success "ANTHROPIC_API_KEY is set"
    return 0
  fi
  # Claude Code internal auth detection
  if [[ -n "${CLAUDE_CODE_ENTRYPOINT:-}" ]]; then
    success "Running inside Claude Code (internal auth)"
    return 0
  fi
  # Claude Code SDK uses OAuth when installed — no API key needed
  if command -v claude &>/dev/null; then
    success "Claude Code CLI found (OAuth auth)"
    return 0
  fi
  error "LLM authentication not available"
  error "  Install Claude Code CLI, set ANTHROPIC_API_KEY, or run from Claude Code terminal"
  return 1
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

# ---------------------------------------------------------------------------
# Environment sanitisation
# ---------------------------------------------------------------------------

# Unset env vars that cause Claude Code nesting detection to fail when
# examples spawn a child Claude Code process via `deno task agent`.
clear_claude_env() {
  unset CLAUDE_CODE CLAUDECODE ANTHROPIC_CLI CLAUDE_SESSION_ID CLAUDE_NEST_LEVEL
  unset CLAUDE_CODE_ENTRYPOINT CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
  unset CLAUDE_CODE_TMPDIR
  unset SANDBOX_ENABLED SANDBOX_ID SANDBOX_ALLOWED_PATHS SANDBOX_RUNTIME
}

export EXAMPLES_DIR REPO_ROOT CLIMPT_REPO_ROOT
export CLIMPT_CMD CLIMPT_DOCS_CMD CLIMPT_MCP_CMD
export -f info success warn error show_cmd
export -f check_deno check_climpt_init check_command check_llm_ready
export -f cleanup_temp_files run_example
export -f clear_claude_env
