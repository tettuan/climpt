#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLES_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${EXAMPLES_DIR}/.." && pwd)"
cd "$EXAMPLES_DIR"
source "${EXAMPLES_DIR}/common_functions.sh"

AGENT_NAME="facilitator"
AGENT_DIR=".agent/${AGENT_NAME}"
AGENT_JSON="${AGENT_DIR}/agent.json"

main() {
  info "=== Configure Agent: ${AGENT_NAME} ==="

  check_command jq

  # Verify agent exists (state from 38)
  if [[ ! -f "$AGENT_JSON" ]]; then
    error ".agent/${AGENT_NAME}/agent.json not found"
    error "Run 38_init_facilitator/run.sh first"
    return 1
  fi

  # --- 1. Patch agent.json ---
  info "Patching agent.json..."
  jq '
    .parameters = {}
    | .runner.verdict = {
        "type": "detect:structured",
        "config": {
          "signalType": "facilitator_decision",
          "requiredFields": ["recommendations", "reasoning"],
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
  "agentId": "facilitator",
  "version": "1.0.0",
  "c1": "steps",
  "entryStepMapping": {
    "detect:structured": "initial.statuscheck"
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
    "initial.statuscheck": {
      "stepId": "initial.statuscheck",
      "name": "Status Check",
      "c2": "initial",
      "c3": "statuscheck",
      "edition": "default",
      "stepKind": "work",
      "uvVariables": [],
      "usesStdin": false,
      "transitions": {
        "next": {
          "target": "closure.facilitation"
        }
      }
    },
    "closure.facilitation": {
      "stepId": "closure.facilitation",
      "name": "Facilitation Closure",
      "c2": "closure",
      "c3": "facilitation",
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

  # Remove default --init prompts (detect:keyword templates don't apply to detect:structured)
  rm -rf "${AGENT_DIR}/prompts/steps/initial/manual"
  rm -rf "${AGENT_DIR}/prompts/steps/continuation/manual"

  cat > "${AGENT_DIR}/prompts/system.md" << 'PROMPT'
# Facilitator Agent

You are operating as the **facilitator** agent.

## Role

You analyze project status files and provide structured recommendations.

## Completion

{uv-verdict_criteria}

## Completion Signal

When your analysis is complete, you MUST output the following action block:

```facilitator_decision
{
  "recommendations": ["your recommendation here"],
  "reasoning": "your reasoning here"
}
```

This structured signal is required for task completion. Do not skip it.
PROMPT

  mkdir -p "${AGENT_DIR}/prompts/steps/initial/statuscheck"
  cat > "${AGENT_DIR}/prompts/steps/initial/statuscheck/f_default.md" << 'PROMPT'
# Status Check Task

## Target File
`tmp/project-status.md`

## Instructions
1. Read `tmp/project-status.md`
2. Analyze the project status
3. Identify risks and blockers
4. Output your decision as a structured signal:

```facilitator_decision
{
  "recommendations": ["list of actionable recommendations"],
  "reasoning": "explanation of your analysis"
}
```
PROMPT

  mkdir -p "${AGENT_DIR}/prompts/steps/closure/facilitation"
  cat > "${AGENT_DIR}/prompts/steps/closure/facilitation/f_default.md" << 'PROMPT'
# Facilitation Closure

Verify your analysis is complete. Output the completion signal:

```facilitator_decision
{
  "recommendations": ["your recommendations"],
  "reasoning": "your reasoning"
}
```
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
# Breakdown Configuration for facilitator-steps
params:
  two:
    directiveType:
      pattern: "^(initial|closure)$"
    layerType:
      pattern: "^(statuscheck|facilitation)$"
USERYML
  success "Breakdown config updated"

  success "PASS: ${AGENT_NAME} configured"
}

main "$@"
