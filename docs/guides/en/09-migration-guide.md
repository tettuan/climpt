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
runner.verdict.*
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
| `behavior.completionType`      | `runner.verdict.type`                             |
| `behavior.completionConfig`    | `runner.verdict.config`                           |
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
    "verdict": {
      "type": "count:iteration",
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

- `behavior.*` splits across `runner.flow`, `runner.verdict`, and
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
   - `behavior.completionType` --> `runner.verdict.type`
   - `behavior.completionConfig` --> `runner.verdict.config`
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
valid `runner.verdict.type` values:

| Type              | Completes when...                                 | `runner.verdict.config`             |
| ----------------- | ------------------------------------------------- | ----------------------------------- |
| `detect:keyword`  | Output contains a keyword                         | `{ "verdictKeyword": "DONE" }`      |
| `count:iteration` | N iterations have run                             | `{ "maxIterations": 5 }`            |
| `poll:state`      | An external condition is met (e.g., Issue closed) | `{}` + `--issue` parameter          |
| `detect:graph`    | All steps complete                                | `{}` + `steps_registry.json`        |
| `meta:custom`     | Custom handler returns true                       | `{ "handlerPath": "./handler.ts" }` |

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

---

---

# 10. Migration Guide: v1.12.0 → v1.13.0

This guide covers how to update your custom `agent.json` and
`steps_registry.json` files from the v1.12.0 configuration format to v1.13.0.

---

## 10.1 Who Needs This?

| Situation                                              | Action                                                                              |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| You use pre-built agents without a custom `agent.json` | You likely do not need this guide. Pre-built agents are updated automatically.      |
| You have custom `agent.json` files                     | Read this guide and migrate your files.                                             |
| You have custom `steps_registry.json` files            | Read Sections 10.3 and 10.5 to update registry keys.                                |
| You are building new agents from scratch               | Skip migration and use the new v1.13.0 structure from the start (see Section 10.4). |

---

## 10.2 What Changed and Why

v1.13.0 renames configuration keys to better reflect their purpose. The word
"completion" was overloaded (it could mean "the agent finished" or "a completion
API call"). v1.13.0 introduces **verdict** for the concept of deciding when an
agent run ends, and **validation** for verifying step outputs.

Key theme: every verdict type now follows a `category:variant` naming pattern
(e.g., `detect:keyword`, `count:iteration`) so that the category communicates
the mechanism at a glance.

---

## 10.3 Migration Mapping Table

### Config Key Renames (`agent.json`)

| Old Path (v1.12.0)         | New Path (v1.13.0)      |
| -------------------------- | ----------------------- |
| `runner.completion.type`   | `runner.verdict.type`   |
| `runner.completion.config` | `runner.verdict.config` |

### Config Field Renames

| Old Field           | New Field        |
| ------------------- | ---------------- |
| `completionKeyword` | `verdictKeyword` |

### Verdict Type Enum Renames

All verdict types now follow a `category:variant` pattern:

| Old Value (v1.12.0) | New Value (v1.13.0) |
| ------------------- | ------------------- |
| `externalState`     | `poll:state`        |
| `iterationBudget`   | `count:iteration`   |
| `checkBudget`       | `count:check`       |
| `keywordSignal`     | `detect:keyword`    |
| `structuredSignal`  | `detect:structured` |
| `stepMachine`       | `detect:graph`      |
| `composite`         | `meta:composite`    |
| `custom`            | `meta:custom`       |

### Steps Registry Renames (`steps_registry.json`)

| Old Key (v1.12.0)      | New Key (v1.13.0)      |
| ---------------------- | ---------------------- |
| `completionConditions` | `validationConditions` |
| `completionSteps`      | `validationSteps`      |
| `completionPatterns`   | `failurePatterns`      |

### C3L Directory Renames

| Old c3 Value (v1.12.0) | New c3 Value (v1.13.0) |
| ---------------------- | ---------------------- |
| `iterate`              | `iteration`            |
| `externalState`        | `polling`              |

---

## 10.4 Before / After Example

### `agent.json`

#### v1.12.0 (Old)

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
      "type": "keywordSignal",
      "config": { "completionKeyword": "DONE" }
    },
    "boundaries": {
      "allowedTools": ["Read", "Write"],
      "permissionMode": "plan"
    }
  }
}
```

#### v1.13.0 (New)

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
    "verdict": {
      "type": "detect:keyword",
      "config": { "verdictKeyword": "DONE" }
    },
    "boundaries": {
      "allowedTools": ["Read", "Write"],
      "permissionMode": "plan"
    }
  }
}
```

### `steps_registry.json`

#### v1.12.0 (Old)

```json
{
  "steps": [
    {
      "name": "plan",
      "completionConditions": { "type": "allFilesWritten" },
      "completionSteps": ["implement"],
      "completionPatterns": {
        "git-dirty": { "edition": "failed", "adaptation": "git-dirty" }
      }
    }
  ]
}
```

#### v1.13.0 (New)

```json
{
  "steps": [
    {
      "name": "plan",
      "stepKind": "work",
      "validationConditions": { "type": "allFilesWritten" },
      "validationSteps": ["implement"],
      "failurePatterns": {
        "git-dirty": { "edition": "failed", "adaptation": "git-dirty" }
      }
    }
  ]
}
```

Key changes to notice:

- `runner.completion` becomes `runner.verdict`.
- `completionKeyword` inside the config object becomes `verdictKeyword`.
- Verdict type values switch from camelCase names to `category:variant` format.
- Steps registry keys `completionConditions`, `completionSteps`, and
  `completionPatterns` become `validationConditions`, `validationSteps`, and
  `failurePatterns`.
- Steps gain an optional `stepKind` field (see Section 10.7).

---

## 10.5 Steps to Migrate

1. **Update `runner.completion` to `runner.verdict`.**
   - `runner.completion.type` --> `runner.verdict.type`
   - `runner.completion.config` --> `runner.verdict.config`

2. **Rename verdict type values.** Use the mapping in Section 10.3 to convert
   camelCase names to `category:variant` format.

3. **Rename config fields.**
   - `completionKeyword` --> `verdictKeyword` (inside `runner.verdict.config`)

4. **Update `steps_registry.json` keys.**
   - `completionConditions` --> `validationConditions`
   - `completionSteps` --> `validationSteps`
   - `completionPatterns` --> `failurePatterns`

5. **Rename C3L directories** (if you have custom prompt trees).
   - `iterate/` --> `iteration/`
   - `externalState/` --> `polling/`

6. **Validate.** Run your agent with the new `--validate` flag to check
   configuration before execution:

   ```bash
   deno task agent --agent {name} --validate
   ```

---

## 10.6 New Features

### `--validate` CLI Option

v1.13.0 adds a `--validate` flag that checks your `agent.json` and
`steps_registry.json` for structural errors without running the agent:

```bash
deno task agent --agent my-agent --validate
```

### `stepKind` Enum

Each step in `steps_registry.json` can now declare a `stepKind` to classify its
role:

| Value          | Meaning                                       |
| -------------- | --------------------------------------------- |
| `work`         | Produces output (code, text, artifacts).      |
| `verification` | Validates output from a previous work step.   |
| `closure`      | Finalizes the run (merge, PR, issue updates). |

### Facilitator Agent

v1.13.0 introduces a **facilitator** agent that coordinates multi-step
pipelines. The facilitator reads the `stepKind` annotations to decide execution
order and handles transitions between steps, including retry logic driven by
`failurePatterns`.

---

## 10.7 File Renames (Framework Developers)

If you import internal modules directly (e.g., for custom verdict handlers),
note the following source file renames:

| Old Path (v1.12.0)       | New Path (v1.13.0)    |
| ------------------------ | --------------------- |
| `completion-types.ts`    | `validation-types.ts` |
| `completion-manager.ts`  | `closure-manager.ts`  |
| `completion-chain.ts`    | `validation-chain.ts` |
| `agents/completion/`     | `agents/verdict/`     |
| `validators/completion/` | `validators/step/`    |

Update any direct imports that reference these paths.

---

## 10.8 Troubleshooting

### "Unknown verdict type" error

You are using a v1.12.0 camelCase type name. Convert it using the mapping in
Section 10.3 (e.g., `keywordSignal` --> `detect:keyword`).

### "Unknown key: runner.completion"

The `runner.completion` key no longer exists. Rename it to `runner.verdict`.

### "Unknown key: completionConditions"

Steps registry keys have been renamed. See the registry mapping in Section 10.3.

### C3L prompt not found

If prompts under the old `iterate/` or `externalState/` directories are not
loading, rename the directories to `iteration/` and `polling/` respectively.
