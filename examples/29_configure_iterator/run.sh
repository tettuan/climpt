#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLES_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${EXAMPLES_DIR}/.." && pwd)"
cd "$EXAMPLES_DIR"
source "${EXAMPLES_DIR}/common_functions.sh"

AGENT_NAME="iterator"
AGENT_DIR=".agent/${AGENT_NAME}"
AGENT_JSON="${AGENT_DIR}/agent.json"

main() {
  info "=== Configure Agent: ${AGENT_NAME} ==="

  check_command jq

  # Verify agent exists (state from 28)
  if [[ ! -f "$AGENT_JSON" ]]; then
    error ".agent/${AGENT_NAME}/agent.json not found"
    error "Run 28_init_iterator/run.sh first"
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
  "agentId": "iterator",
  "version": "1.0.0",
  "c1": "steps",
  "entryStepMapping": {
    "detect:keyword": { "initial": "initial.task", "continuation": "initial.task" }
  },
  "steps": {
    "system": {
      "stepId": "system",
      "name": "System Prompt",
      "kind": "work",
      "address": {
        "c1": "steps",
        "c2": "system",
        "c3": "prompt",
        "edition": "default"
      },
      "uvVariables": ["uv-agent_name", "uv-verdict_criteria"],
      "usesStdin": false
    },
    "initial.task": {
      "stepId": "initial.task",
      "name": "Fix Bug Task",
      "kind": "work",
      "address": {
        "c1": "steps",
        "c2": "initial",
        "c3": "task",
        "edition": "default"
      },
      "uvVariables": [],
      "usesStdin": false,
      "transitions": {
        "next": {
          "target": "closure.task"
        }
      }
    },
    "closure.task": {
      "stepId": "closure.task",
      "name": "Task Closure",
      "kind": "closure",
      "address": {
        "c1": "steps",
        "c2": "closure",
        "c3": "task",
        "edition": "default"
      },
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
# Iterator Agent

You are operating as the **iterator** agent.

## Role

You fix bugs in code files. Read the target file, identify the bug described in the task prompt, fix it, and verify the fix.

## Completion

{uv-verdict_criteria}

## Rules

- Only modify the file specified in the task
- Do not create new files beyond what is asked
- Output TASK_COMPLETE as the final line of your response when done
PROMPT

  mkdir -p "${AGENT_DIR}/prompts/steps/initial/task"
  cat > "${AGENT_DIR}/prompts/steps/initial/task/f_default.md" << 'PROMPT'
# Bug Fix Task

## Target File
`tmp/iterator-fixture.ts`

## Bug Description
The function `add(a, b)` should return the sum of two numbers, but it currently returns the product (`a * b`). Fix it to return `a + b`.

## Steps
1. Read `tmp/iterator-fixture.ts`
2. Change `return a * b` to `return a + b`
3. Verify the fix by reading the file again
4. Output TASK_COMPLETE
PROMPT

  mkdir -p "${AGENT_DIR}/prompts/steps/closure/task"
  cat > "${AGENT_DIR}/prompts/steps/closure/task/f_default.md" << 'PROMPT'
# Task Closure

Verify the bug fix was applied correctly. Read `tmp/iterator-fixture.ts` and confirm the `add` function returns `a + b`.

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
# Breakdown Configuration for iterator-steps
params:
  two:
    directiveType:
      pattern: "^(initial|closure)$"
    layerType:
      pattern: "^(task)$"
USERYML
  success "Breakdown config updated"

  success "PASS: ${AGENT_NAME} configured"
}

main "$@"
