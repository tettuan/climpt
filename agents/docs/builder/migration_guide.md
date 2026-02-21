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

| Claude Code Option               | agent.json Path                    |
| -------------------------------- | ---------------------------------- |
| `--system-prompt`                | `runner.flow.systemPromptPath`     |
| `--allowed-tools`                | `runner.boundaries.allowedTools`   |
| `--permission-mode`              | `runner.boundaries.permissionMode` |
| `--dangerously-skip-permissions` | `runner.boundaries.sandbox`        |
| `--resume`                       | Auto-managed (sessionId)           |

### v1.12.0 Config Migration (behavior -> runner.*)

v1.12.0 で `behavior`/`prompts`/`logging`/`github`/`worktree`/`finalize`
のフラット構造を `runner.*` 階層に置き換えた。全フィールドの対応表:

| Old Path (v1.11.x)             | New Path (v1.12.0)                                |
| ------------------------------ | ------------------------------------------------- |
| `behavior.systemPromptPath`    | `runner.flow.systemPromptPath`                    |
| `behavior.completionType`      | `runner.completion.type`                          |
| `behavior.completionConfig`    | `runner.completion.config`                        |
| `behavior.allowedTools`        | `runner.boundaries.allowedTools`                  |
| `behavior.permissionMode`      | `runner.boundaries.permissionMode`                |
| `behavior.sandboxConfig`       | `runner.boundaries.sandbox`                       |
| `behavior.askUserAutoResponse` | `runner.flow.askUserAutoResponse`                 |
| `behavior.defaultModel`        | `runner.flow.defaultModel`                        |
| `prompts.registry`             | `runner.flow.prompts.registry`                    |
| `prompts.fallbackDir`          | `runner.flow.prompts.fallbackDir`                 |
| `github.enabled`               | `runner.integrations.github.enabled`              |
| `github.labels`                | `runner.integrations.github.labels`               |
| `github.defaultClosureAction`  | `runner.integrations.github.defaultClosureAction` |
| `actions.enabled`              | `runner.actions.enabled`                          |
| `actions.allowedTypes`         | `runner.actions.types`                            |
| `worktree.enabled`             | `runner.execution.worktree.enabled`               |
| `worktree.root`                | `runner.execution.worktree.root`                  |
| `finalize.autoMerge`           | `runner.execution.finalize.autoMerge`             |
| `finalize.push`                | `runner.execution.finalize.push`                  |
| `finalize.remote`              | `runner.execution.finalize.remote`                |
| `finalize.createPr`            | `runner.execution.finalize.createPr`              |
| `finalize.prTarget`            | `runner.execution.finalize.prTarget`              |
| `logging.directory`            | `runner.logging.directory`                        |
| `logging.format`               | `runner.logging.format`                           |

**削除されたフィールド:**

| フィールド                    | 理由                               |
| ----------------------------- | ---------------------------------- |
| `behavior.preCloseValidation` | Dead config — TypeScript型に未定義 |
| `behavior.disableSandbox`     | `runner.boundaries.sandbox` に統合 |

### Before / After 比較

**v1.11.x (Old):**

```json
{
  "name": "my-agent",
  "displayName": "My Agent",
  "description": "...",
  "version": "1.0.0",
  "behavior": {
    "systemPromptPath": "prompts/system.md",
    "completionType": "iterationBudget",
    "completionConfig": { "maxIterations": 10 },
    "allowedTools": ["Read", "Write"],
    "permissionMode": "plan"
  },
  "parameters": {},
  "prompts": {
    "registry": "steps_registry.json",
    "fallbackDir": "prompts/"
  },
  "github": {
    "enabled": true,
    "labels": {},
    "defaultClosureAction": "close"
  },
  "logging": {
    "directory": "tmp/logs/agents/my-agent",
    "format": "jsonl"
  }
}
```

**v1.12.0 (New):**

```json
{
  "name": "my-agent",
  "displayName": "My Agent",
  "description": "...",
  "version": "1.0.0",
  "parameters": {},
  "runner": {
    "flow": {
      "systemPromptPath": "prompts/system.md",
      "prompts": {
        "registry": "steps_registry.json",
        "fallbackDir": "prompts/"
      }
    },
    "completion": {
      "type": "iterationBudget",
      "config": { "maxIterations": 10 }
    },
    "boundaries": {
      "allowedTools": ["Read", "Write"],
      "permissionMode": "plan",
      "github": {
        "enabled": true,
        "labels": {},
        "defaultClosureAction": "close"
      }
    },
    "execution": {},
    "logging": {
      "directory": "tmp/logs/agents/my-agent",
      "format": "jsonl"
    }
  }
}
```

### runner.* 設計原則

| runner サブキー       | 担当モジュール       | 管理対象                         |
| --------------------- | -------------------- | -------------------------------- |
| `runner.flow`         | FlowOrchestrator     | プロンプト解決、ステップ遷移     |
| `runner.completion`   | CompletionManager    | 完了判定戦略と設定               |
| `runner.boundaries`   | QueryExecutor, Hooks | ツール許可、権限、サンドボックス |
| `runner.integrations` | CompletionManager    | 外部連携 (GitHub)                |
| `runner.actions`      | ActionDetector       | アクション検出・タイプ           |
| `runner.execution`    | run-agent.ts         | ワークツリー、ファイナライズ     |
| `runner.logging`      | Logger               | ログ出力設定                     |

### Completion Condition Migration

| Current Implementation                       | runner.completion.type | runner.completion.config            |
| -------------------------------------------- | ---------------------- | ----------------------------------- |
| Complete when output contains "DONE"         | `keywordSignal`        | `{ "completionKeyword": "DONE" }`   |
| Complete after 3 executions                  | `iterationBudget`      | `{ "maxIterations": 3 }`            |
| Complete when Issue #42 is resolved          | `externalState`        | `{}` + `--issue 42` parameter       |
| Custom logic                                 | `custom`               | `{ "handlerPath": "./handler.ts" }` |
| Multiple phases (analyze->implement->review) | `stepMachine`          | `{}` + `steps_registry.json`        |

### Prompt Structure Migration

**Traditional Model (iterationBudget/keywordSignal):**

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

**Step Flow Model (stepMachine):**

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
  "version": "1.0.0",
  "description": "Code review agent",
  "parameters": {
    "target": {
      "type": "string",
      "required": true,
      "cli": "--target"
    }
  },
  "runner": {
    "flow": {
      "systemPromptPath": "prompts/system.md",
      "prompts": {
        "registry": "steps_registry.json",
        "fallbackDir": "prompts/"
      }
    },
    "completion": {
      "type": "keywordSignal",
      "config": { "completionKeyword": "REVIEW_COMPLETE" }
    },
    "boundaries": {
      "allowedTools": ["Read", "Glob", "Grep"],
      "permissionMode": "plan"
    },
    "execution": {},
    "logging": {
      "directory": "tmp/logs/agents/code-reviewer",
      "format": "jsonl"
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
  "displayName": "Issue Resolver",
  "version": "1.0.0",
  "description": "Resolves GitHub issues autonomously",
  "parameters": {
    "issue": {
      "type": "number",
      "required": true,
      "cli": "--issue"
    }
  },
  "runner": {
    "flow": {
      "systemPromptPath": "prompts/system.md",
      "prompts": {
        "registry": "steps_registry.json",
        "fallbackDir": "prompts/"
      }
    },
    "completion": {
      "type": "externalState",
      "config": { "maxIterations": 500 }
    },
    "boundaries": {
      "allowedTools": ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      "permissionMode": "acceptEdits",
      "github": { "enabled": true }
    },
    "execution": {},
    "logging": {
      "directory": "tmp/logs/agents/issue-resolver",
      "format": "jsonl"
    }
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
  "displayName": "Iterative Task",
  "version": "1.0.0",
  "description": "Fixed iteration agent",
  "parameters": {},
  "runner": {
    "flow": {
      "systemPromptPath": "prompts/system.md",
      "prompts": {
        "registry": "steps_registry.json",
        "fallbackDir": "prompts/"
      }
    },
    "completion": {
      "type": "iterationBudget",
      "config": { "maxIterations": 5 }
    },
    "boundaries": {
      "allowedTools": ["Read", "Write"],
      "permissionMode": "plan"
    },
    "execution": {},
    "logging": {
      "directory": "tmp/logs/agents/iterative-task",
      "format": "jsonl"
    }
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
  "version": "1.0.0",
  "description": "Multi-phase code improvement",
  "parameters": {},
  "runner": {
    "flow": {
      "systemPromptPath": "prompts/system.md",
      "prompts": {
        "registry": "steps_registry.json",
        "fallbackDir": "prompts/"
      }
    },
    "completion": {
      "type": "stepMachine",
      "config": {}
    },
    "boundaries": {
      "allowedTools": ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      "permissionMode": "acceptEdits"
    },
    "execution": {},
    "logging": {
      "directory": "tmp/logs/agents/code-improver",
      "format": "jsonl"
    }
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
  - [ ] runner.flow.systemPromptPath
  - [ ] runner.completion.type
  - [ ] runner.boundaries.allowedTools
  - [ ] runner.boundaries.permissionMode
  - [ ] runner.flow.prompts.registry
  - [ ] runner.flow.prompts.fallbackDir
  - [ ] runner.logging.directory
  - [ ] runner.logging.format

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
- [ ] runner.actions settings (if action output needed)
- [ ] runner.integrations.github settings (if GitHub integration needed)
- [ ] runner.execution.worktree settings (if Git worktree needed)
- [ ] runner.execution.finalize settings (if auto-merge/PR needed)

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

---

## 関連ドキュメント

| ドキュメント                                                       | 内容                 |
| ------------------------------------------------------------------ | -------------------- |
| [01_quickstart.md](./01_quickstart.md)                             | 新規 Agent 作成手順  |
| [02_agent_definition.md](./02_agent_definition.md)                 | agent.json の詳細    |
| [migration_incompatibilities.md](./migration_incompatibilities.md) | 破壊的変更一覧       |
| [migration_template.md](./migration_template.md)                   | 移行作業テンプレート |
