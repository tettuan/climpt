# Migration Guide

Guide for migrating existing agents to the climpt-agents framework.

---

## Migration Flow

```
1. Fill out migration request form (migration_template.md)
2. Generate agent.json
3. Generate steps_registry.json
4. Place prompt files
5. Verify operation
```

---

## Mapping Tables

### Claude Code Options -> agent.json

| Claude Code Option               | agent.json Path                 |
| -------------------------------- | ------------------------------- |
| `--system-prompt`                | `behavior.systemPromptPath`     |
| `--allowed-tools`                | `behavior.allowedTools`         |
| `--permission-mode`              | `behavior.permissionMode`       |
| `--dangerously-skip-permissions` | `behavior.disableSandbox: true` |
| `--resume`                       | Auto-managed (sessionId)        |

### Completion Condition Migration

| Current Implementation                       | completionType | completionConfig                    |
| -------------------------------------------- | -------------- | ----------------------------------- |
| Complete when output contains "DONE"         | `manual`       | `{ "completionKeyword": "DONE" }`   |
| Complete after 3 executions                  | `iterate`      | `{ "maxIterations": 3 }`            |
| Complete when Issue #42 is resolved          | `issue`        | `{}` + `--issue 42` parameter       |
| Custom logic                                 | `custom`       | `{ "handlerPath": "./handler.ts" }` |
| Multiple phases (analyze->implement->review) | `stepFlow`     | `{}` + `steps_registry.json`        |

### Prompt Structure Migration

**Traditional Model (iterate/manual):**

```
.agent/{agent-name}/
+-- prompts/
|   +-- system.md              <- System prompt
|   +-- steps/
|       +-- initial/
|       |   +-- {type}/
|       |       +-- f_default.md  <- Initial prompt
|       +-- continuation/
|           +-- {type}/
|               +-- f_default.md  <- Continuation prompt
+-- steps_registry.json
```

**Step Flow Model (stepFlow):**

```
.agent/{agent-name}/
+-- prompts/
|   +-- system.md
|   +-- steps/
|   |   +-- phase/
|   |       +-- analyze/
|   |       |   +-- f_default.md  <- Analysis step
|   |       +-- implement/
|   |       |   +-- f_default.md  <- Implementation step
|   |       +-- review/
|   |           +-- f_default.md  <- Review step
|   +-- checks/
|       +-- step/
|       |   +-- analyze/
|       |   |   +-- f_default.md  <- Analysis completion check
|       |   +-- implement/
|       |       +-- f_default.md  <- Implementation completion check
|       +-- completion/
|           +-- final/
|               +-- f_default.md  <- Final completion check
+-- steps_registry.json
```

See [08_step_flow_design.md](../design/08_step_flow_design.md) for details.

---

## Migration Examples

### Example 1: Simple Code Review Agent

**Before Migration (Script):**

```typescript
const result = await query({
  prompt: `Review code in ${targetDir}`,
  options: {
    systemPrompt: "You are a code reviewer...",
    allowedTools: ["Read", "Glob", "Grep"],
    permissionMode: "plan",
  },
});
```

**After Migration:**

`agent.json`:

```json
{
  "name": "code-reviewer",
  "displayName": "Code Reviewer",
  "behavior": {
    "systemPromptPath": "prompts/system.md",
    "completionType": "manual",
    "completionConfig": { "completionKeyword": "REVIEW_COMPLETE" },
    "allowedTools": ["Read", "Glob", "Grep"],
    "permissionMode": "plan"
  },
  "parameters": {
    "target": {
      "type": "string",
      "required": true,
      "cli": "--target"
    }
  }
}
```

Execution:

```bash
deno task agent --agent code-reviewer --target src/
```

---

### Example 2: Issue Resolution Agent

**Before Migration:**

```bash
# Get Issue content and pass to Claude
gh issue view 42 --json body | claude --system-prompt "..."
# Manually close Issue after completion
```

**After Migration:**

`agent.json`:

```json
{
  "name": "issue-resolver",
  "behavior": {
    "completionType": "issue",
    "allowedTools": ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
    "permissionMode": "acceptEdits"
  },
  "parameters": {
    "issue": {
      "type": "number",
      "required": true,
      "cli": "--issue"
    }
  },
  "github": {
    "enabled": true
  }
}
```

Execution:

```bash
deno task agent:iterator --issue 42
# Auto-completes when Issue is closed
```

---

### Example 3: Iterative Execution Agent

**Before Migration:**

```bash
for i in {1..5}; do
  claude --prompt "Iteration $i: continue task..."
done
```

**After Migration:**

`agent.json`:

```json
{
  "name": "iterative-task",
  "behavior": {
    "completionType": "iterate",
    "completionConfig": { "maxIterations": 5 }
  }
}
```

Execution:

```bash
deno task agent --agent iterative-task --topic "Task content"
```

---

### Example 4: Step Flow Agent

**Before Migration (Multiple Scripts):**

```bash
# Execute manually for each phase
claude --prompt "Analyze code and identify issues"
# Check results
claude --prompt "Fix issues"
# Check results
claude --prompt "Review fixes"
```

**After Migration:**

`agent.json`:

```json
{
  "name": "code-improver",
  "displayName": "Code Improver",
  "behavior": {
    "systemPromptPath": "prompts/system.md",
    "completionType": "stepFlow",
    "completionConfig": {},
    "allowedTools": ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
    "permissionMode": "acceptEdits"
  },
  "prompts": {
    "registry": "steps_registry.json",
    "fallbackDir": "prompts/"
  }
}
```

`steps_registry.json`:

```json
{
  "version": "2.0.0",
  "basePath": "prompts",
  "entryStep": "s_a8f3",
  "steps": {
    "s_a8f3": {
      "id": "s_a8f3",
      "name": "Code Analysis",
      "prompt": { "c1": "steps", "c2": "phase", "c3": "analyze" },
      "iterations": { "min": 1, "max": 1 },
      "check": {
        "prompt": { "c1": "checks", "c2": "step", "c3": "analyze" },
        "responseFormat": { "result": "ok|ng", "message": "string" },
        "onPass": { "next": "s_b2c1" },
        "onFail": { "retry": true, "maxRetries": 2 }
      }
    },
    "s_b2c1": {
      "id": "s_b2c1",
      "name": "Implementation",
      "prompt": { "c1": "steps", "c2": "phase", "c3": "implement" },
      "check": {
        "prompt": { "c1": "checks", "c2": "step", "c3": "implement" },
        "responseFormat": { "result": "ok|ng", "message": "string" },
        "onPass": { "next": "s_c9d4" },
        "onFail": { "fallback": "s_a8f3" }
      }
    },
    "s_c9d4": {
      "id": "s_c9d4",
      "name": "Review",
      "prompt": { "c1": "steps", "c2": "phase", "c3": "review" },
      "check": {
        "prompt": { "c1": "checks", "c2": "completion", "c3": "final" },
        "responseFormat": { "result": "ok|ng", "message": "string" },
        "onPass": { "complete": true },
        "onFail": { "fallback": "s_b2c1" }
      }
    }
  }
}
```

Execution:

```bash
deno task agent --agent code-improver --topic "Improve authentication module"
# Automatically transitions: analyze -> implement -> review
# Falls back to previous step on failure
```

---

## Migration Checklist

### Required Items

- [ ] Create `agent.json`
  - [ ] name (kebab-case)
  - [ ] displayName
  - [ ] description
  - [ ] behavior.systemPromptPath
  - [ ] behavior.completionType
  - [ ] behavior.allowedTools
  - [ ] behavior.permissionMode
  - [ ] prompts.registry
  - [ ] prompts.fallbackDir
  - [ ] logging.directory
  - [ ] logging.format

- [ ] Create `steps_registry.json`
  - **For traditional model (iterate/manual):**
    - [ ] system step definition
    - [ ] initial step definition
    - [ ] continuation step definition
  - **For step flow model (stepFlow):**
    - [ ] entryStep setting
    - [ ] Each step definition (id, name, prompt)
    - [ ] Check definitions (prompt, onPass, onFail)
    - [ ] Transition conditions (next, fallback, retry, complete)

- [ ] Create prompt files
  - [ ] system.md
  - **For traditional model:**
    - [ ] Initial prompt
    - [ ] Continuation prompt
  - **For step flow:**
    - [ ] Prompts for each step
    - [ ] Prompts for each check

### Optional Items

- [ ] parameters definition (if CLI parameters needed)
- [ ] actions settings (if action output needed)
- [ ] github settings (if GitHub integration needed)
- [ ] worktree settings (if Git worktree needed)

### Verification

- [ ] Agent appears in `deno task agent --list`
- [ ] `deno task agent --agent {name} --help` shows help
- [ ] Verify operation with actual task
- [ ] Confirm completion conditions work correctly
- [ ] Confirm actions execute correctly

---

## Troubleshooting

### Error: Agent not found

```bash
# Check .agent/ directory location
ls -la .agent/

# Check agent.json path
ls -la .agent/{agent-name}/agent.json
```

### Error: Prompt not found

```bash
# Check steps_registry.json path/C3L settings
# Verify they match actual prompt file paths

# Check fallbackDir is configured correctly
```

### Error: Module resolution

```bash
# Clear cache and re-execute
deno cache --reload mod.ts
```
