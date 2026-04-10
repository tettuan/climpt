#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLES_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${EXAMPLES_DIR}/.." && pwd)"
cd "$EXAMPLES_DIR"
source "${EXAMPLES_DIR}/common_functions.sh"

AGENT_NAME="reviewer"
AGENT_DIR=".agent/${AGENT_NAME}"
AGENT_JSON="${AGENT_DIR}/agent.json"

main() {
  info "=== Configure Agent: ${AGENT_NAME} ==="

  check_command jq

  # Verify agent exists (state from 33)
  if [[ ! -f "$AGENT_JSON" ]]; then
    error ".agent/${AGENT_NAME}/agent.json not found"
    error "Run 33_init_reviewer/run.sh first"
    return 1
  fi

  # --- 1. Patch agent.json ---
  info "Patching agent.json..."
  jq '
    .parameters = {}
    | .runner.verdict = {
        "type": "detect:keyword",
        "config": {
          "verdictKeyword": "TASK_COMPLETE",
          "maxIterations": 3
        }
      }
    | .runner.integrations.github.enabled = false
    | .runner.execution.worktree.enabled = false
  ' "$AGENT_JSON" > "${AGENT_JSON}.tmp" && mv "${AGENT_JSON}.tmp" "$AGENT_JSON"
  success "agent.json patched"

  # --- 2. Write steps_registry.json ---
  info "Writing steps_registry.json..."
  cat > "${AGENT_DIR}/steps_registry.json" << 'REGISTRY'
{
  "agentId": "reviewer",
  "version": "1.0.0",
  "c1": "steps",
  "entryStepMapping": {
    "detect:keyword": "initial.review"
  },
  "steps": {
    "system": {
      "stepId": "system",
      "name": "System Prompt",
      "c2": "system",
      "c3": "prompt",
      "edition": "default",
      "uvVariables": ["uv-agent_name", "uv-verdict_criteria"],
      "usesStdin": false
    },
    "initial.review": {
      "stepId": "initial.review",
      "name": "Code Review",
      "c2": "initial",
      "c3": "review",
      "edition": "default",
      "stepKind": "work",
      "uvVariables": [],
      "usesStdin": false,
      "transitions": {
        "next": {
          "target": "closure.review"
        }
      }
    },
    "closure.review": {
      "stepId": "closure.review",
      "name": "Review Closure",
      "c2": "closure",
      "c3": "review",
      "edition": "default",
      "stepKind": "closure",
      "uvVariables": [],
      "usesStdin": false,
      "transitions": {}
    }
  }
}
REGISTRY
  success "steps_registry.json written"

  # --- 3. Write prompts ---
  info "Writing prompt files..."

  cat > "${AGENT_DIR}/prompts/system.md" << 'PROMPT'
# Reviewer Agent

You are operating as the **reviewer** agent.

## Role

You review code files for correctness, style, and potential issues. Read the target file, analyze it, and write a review summary.

## Completion

{uv-verdict_criteria}

## Rules

- Read the target file carefully before writing the review
- Write findings to the specified output file
- Output TASK_COMPLETE as the final line of your response when done
PROMPT

  mkdir -p "${AGENT_DIR}/prompts/steps/initial/review"
  cat > "${AGENT_DIR}/prompts/steps/initial/review/f_default.md" << 'PROMPT'
# Code Review Task

## Target File
`tmp/review-target.ts`

## Output File
`tmp/review-result.md`

## Instructions
1. Read `tmp/review-target.ts`
2. Identify all issues (bugs, style problems, missing error handling)
3. Write your findings to `tmp/review-result.md` in markdown format
4. Output TASK_COMPLETE
PROMPT

  mkdir -p "${AGENT_DIR}/prompts/steps/closure/review"
  cat > "${AGENT_DIR}/prompts/steps/closure/review/f_default.md" << 'PROMPT'
# Review Closure

Verify the review was written to `tmp/review-result.md`.

Output TASK_COMPLETE when verified.
PROMPT
  success "Prompt files written"

  # --- 4. Update breakdown config ---
  info "Updating breakdown config..."
  local config_dir=".agent/climpt/config"
  mkdir -p "$config_dir"

  cat > "${config_dir}/${AGENT_NAME}-steps-app.yml" << APPYML
# Build Configuration for ${AGENT_NAME}-steps
working_dir: ".agent/${AGENT_NAME}"
app_prompt:
  base_dir: "prompts/steps"
app_schema:
  base_dir: "schema/steps"
APPYML

  cat > "${config_dir}/${AGENT_NAME}-steps-user.yml" << 'USERYML'
# Breakdown Configuration for reviewer-steps
params:
  two:
    directiveType:
      pattern: "^(initial|closure)$"
    layerType:
      pattern: "^(review)$"
USERYML
  success "Breakdown config updated"

  success "PASS: ${AGENT_NAME} configured"
}

main "$@"
