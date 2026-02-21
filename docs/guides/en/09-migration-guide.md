[English](../en/09-migration-guide.md) | [日本語](../ja/09-migration-guide.md)

# 9. Migration Guide: v1.11.x → v1.12.0

This guide covers how to update your custom `agent.json` files from the v1.11.x
flat configuration format to the v1.12.0 `runner.*` hierarchy.

---

## 9.1 Who Needs This?

| Situation                                              | Action                                                                             |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| You use pre-built agents without a custom `agent.json` | You likely do not need this guide. Pre-built agents are updated automatically.     |
| You have custom `agent.json` files                     | Read this guide and migrate your files.                                            |
| You are building new agents from scratch               | Skip migration and use the new v1.12.0 structure from the start (see Section 9.4). |

---

## 9.2 What Changed and Why

In v1.11.x, agent configuration used flat top-level keys:

```
behavior.*
prompts.*
logging.*
github.*
worktree.*
finalize.*
actions.*
```

In v1.12.0, all of these move under a single `runner` key, organized into
sub-groups:

```
runner.flow.*
runner.completion.*
runner.boundaries.*
runner.integrations.*
runner.actions.*
runner.execution.*
runner.logging.*
```

**Why?** Each sub-group corresponds to the runtime module that owns the
configuration. This makes it clear which part of the system consumes each
setting, and prevents naming collisions as new features are added.

---

## 9.3 Migration Mapping Table

### Full Field Mapping

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

### Removed Fields

| Old Field                     | Reason                                           |
| ----------------------------- | ------------------------------------------------ |
| `behavior.preCloseValidation` | Dead config -- never defined in the type system. |
| `behavior.disableSandbox`     | Merged into `runner.boundaries.sandbox`.         |

---

## 9.4 Before / After Example

### v1.11.x (Old)

```json
{
  "name": "my-agent",
  "displayName": "My Agent",
  "description": "Example agent",
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

### v1.12.0 (New)

```json
{
  "name": "my-agent",
  "displayName": "My Agent",
  "description": "Example agent",
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
      "permissionMode": "plan"
    },
    "integrations": {
      "github": {
        "enabled": true,
        "labels": {},
        "defaultClosureAction": "close"
      }
    },
    "logging": {
      "directory": "tmp/logs/agents/my-agent",
      "format": "jsonl"
    }
  }
}
```

Key structural changes to notice:

- `behavior.*` splits across `runner.flow`, `runner.completion`, and
  `runner.boundaries` based on what each field controls.
- `prompts.*` moves inside `runner.flow.prompts`.
- `github.*` moves to `runner.integrations.github`.
- `logging.*` moves to `runner.logging`.
- `worktree.*` and `finalize.*` move to `runner.execution.worktree` and
  `runner.execution.finalize` respectively.

---

## 9.5 Steps to Migrate

1. **Open your `agent.json` file.**

2. **Create the `runner` object.** Add an empty `runner: {}` key at the top
   level of your agent definition.

3. **Move `behavior` fields into `runner`.**
   - `behavior.systemPromptPath` --> `runner.flow.systemPromptPath`
   - `behavior.completionType` --> `runner.completion.type`
   - `behavior.completionConfig` --> `runner.completion.config`
   - `behavior.allowedTools` --> `runner.boundaries.allowedTools`
   - `behavior.permissionMode` --> `runner.boundaries.permissionMode`
   - `behavior.sandboxConfig` --> `runner.boundaries.sandbox`
   - `behavior.askUserAutoResponse` --> `runner.flow.askUserAutoResponse`
   - `behavior.defaultModel` --> `runner.flow.defaultModel`

4. **Move `prompts` fields.**
   - `prompts.registry` --> `runner.flow.prompts.registry`
   - `prompts.fallbackDir` --> `runner.flow.prompts.fallbackDir`

5. **Move `github` fields** (if present).
   - Wrap all `github.*` fields under `runner.integrations.github`.

6. **Move `actions` fields** (if present).
   - `actions.enabled` --> `runner.actions.enabled`
   - `actions.allowedTypes` --> `runner.actions.types`

7. **Move `worktree` and `finalize` fields** (if present).
   - `worktree.*` --> `runner.execution.worktree.*`
   - `finalize.*` --> `runner.execution.finalize.*`

8. **Move `logging` fields.**
   - `logging.*` --> `runner.logging.*`

9. **Remove old top-level keys.** Delete `behavior`, `prompts`, `github`,
   `actions`, `worktree`, `finalize`, and `logging` from the top level.

10. **Remove dead fields.** If your config includes
    `behavior.preCloseValidation` or `behavior.disableSandbox`, remove them. Use
    `runner.boundaries.sandbox` for sandbox control instead.

11. **Validate.** Run your agent and confirm it loads without errors:

    ```bash
    deno task agent --agent {name} --help
    ```

---

## 9.6 Completion Type Reference

If you are migrating `behavior.completionType`, here is a quick reference for
valid `runner.completion.type` values:

| Type              | Completes when...                                 | `runner.completion.config`          |
| ----------------- | ------------------------------------------------- | ----------------------------------- |
| `keywordSignal`   | Output contains a keyword                         | `{ "completionKeyword": "DONE" }`   |
| `iterationBudget` | N iterations have run                             | `{ "maxIterations": 5 }`            |
| `externalState`   | An external condition is met (e.g., Issue closed) | `{}` + `--issue` parameter          |
| `stepMachine`     | All steps complete                                | `{}` + `steps_registry.json`        |
| `custom`          | Custom handler returns true                       | `{ "handlerPath": "./handler.ts" }` |

---

## 9.7 Troubleshooting

### Agent not found

Verify the `agent.json` file is in the correct location:

```bash
ls -la .agent/{agent-name}/agent.json
```

### Prompt not found

Check that `runner.flow.prompts.registry` points to a valid
`steps_registry.json` and that `runner.flow.prompts.fallbackDir` matches your
prompt directory structure.

### Module resolution errors

Clear the Deno cache and retry:

```bash
deno cache --reload mod.ts
```
