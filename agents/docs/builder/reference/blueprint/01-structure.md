# 1. Blueprint Structure

## Top-level

Blueprint は3つのセクションを持つ JSON ファイルである。

```json
{
  "$schema": "agent-blueprint.schema.json",
  "agent": {},
  "registry": {},
  "schemas": {}
}
```

| セクション | 内容                                        | 分割先                |
| ---------- | ------------------------------------------- | --------------------- |
| `agent`    | agent.json の全内容                         | agent.json            |
| `registry` | steps_registry.json の全内容                | steps_registry.json   |
| `schemas`  | schemas/*.schema.json の definitions を統合 | schemas/*.schema.json |

## 設計原則

1. **Runtime の語彙をそのまま使う** — agent.json
   のフィールド名、steps_registry.json
   のフィールド名をそのまま書く。新しい用語を発明しない。
2. **全フィールドを明示的に書く** — 推論・自動補完はしない。AI が全てを書く。
3. **Schema が cross-ref ルールを検証する** — 1つの JSON
   にまとめることで、ファイル間参照を JSON Schema 内参照に変換する。

## Section 1: `agent`

agent.json の内容をそのまま書く。

```json
"agent": {
  "name": "iterator",
  "displayName": "Iterator Agent",
  "description": "Iterates on GitHub Issues to implement requirements",
  "version": "1.0.0",
  "runner": {
    "flow": {
      "systemPromptPath": "prompts/system.md",
      "prompts": {
        "registry": "steps_registry.json",
        "fallbackDir": "prompts/"
      },
      "defaultModel": "opus"
    },
    "verdict": {
      "type": "poll:state",
      "config": {
        "maxIterations": 500,
        "resourceType": "github-issue",
        "targetState": "closed"
      }
    },
    "boundaries": {
      "allowedTools": ["Skill", "Read", "Write", "Edit", "Bash", "Glob", "Grep", "Task", "TodoWrite"],
      "permissionMode": "acceptEdits"
    },
    "integrations": {
      "github": {
        "enabled": true,
        "labels": {
          "requirements": "requirements",
          "inProgress": "in-progress",
          "blocked": "blocked",
          "completion": {
            "add": ["completed"],
            "remove": ["in-progress", "blocked"]
          }
        },
        "defaultClosureAction": "close"
      }
    },
    "actions": {
      "enabled": true,
      "types": ["issue-action", "project-plan", "review-result"],
      "outputFormat": "json"
    },
    "execution": {
      "worktree": { "enabled": true, "root": "../worktree" }
    },
    "logging": {
      "directory": "logs",
      "format": "jsonl",
      "maxFiles": 100
    }
  },
  "parameters": {
    "issue": {
      "type": "number",
      "description": "GitHub Issue number to work on",
      "required": true,
      "cli": "--issue"
    },
    "iterateMax": {
      "type": "number",
      "description": "Maximum iterations",
      "required": false,
      "default": 500,
      "cli": "--iterate-max"
    }
  }
}
```

**agent.schema.json と同じ構造。追加・省略なし。**

## Section 2: `registry`

steps_registry.json の内容をそのまま書く。

```json
"registry": {
  "agentId": "iterator",
  "version": "3.0.0",
  "c1": "steps",
  "pathTemplate": "{c1}/{c2}/{c3}/f_{edition}_{adaptation}.md",
  "pathTemplateNoAdaptation": "{c1}/{c2}/{c3}/f_{edition}.md",
  "entryStepMapping": {
  "poll:state": "initial.polling",
  "count:iteration": "initial.iteration"
},
"steps": {
  "initial.issue": {
    "stepId": "initial.issue",
    "name": "Issue Analysis",
    "c2": "initial",
    "c3": "issue",
    "edition": "default",
    "stepKind": "work",
    "uvVariables": ["issue"],
    "usesStdin": false,
    "model": "sonnet",
    "outputSchemaRef": {
      "file": "issue.schema.json",
      "schema": "initial.issue"
    },
    "structuredGate": {
      "allowedIntents": ["next", "repeat"],
      "intentSchemaRef": "#/properties/next_action/properties/action",
      "intentField": "next_action.action",
      "targetField": "next_action.details.target",
      "failFast": true
    },
    "transitions": {
      "next": { "target": "continuation.issue" },
      "repeat": { "target": "initial.issue" }
    }
  }
},
"validators": {
  "git-clean": {
    "type": "command",
    "command": "git status --porcelain",
    "successWhen": "empty",
    "failurePattern": "git-dirty",
    "extractParams": {
      "changedFiles": "parseChangedFiles",
      "untrackedFiles": "parseUntrackedFiles"
    }
  }
},
"failurePatterns": {
  "git-dirty": {
    "description": "Uncommitted changes present",
    "edition": "failed",
    "adaptation": "git-dirty",
    "params": ["changedFiles", "untrackedFiles"]
  }
},
"validationSteps": {
  "closure.issue": {
    "stepId": "closure.issue",
    "name": "Issue Validation",
    "c2": "retry",
    "c3": "issue",
    "validationConditions": [
      { "validator": "git-clean" },
      { "validator": "type-check" }
    ],
    "onFailure": { "action": "retry", "maxAttempts": 3 },
    "outputSchemaRef": {
      "file": "issue.schema.json",
      "schema": "closure.issue"
    }
  }
}
}
```

**steps_registry.schema.json と同じ構造。追加・省略なし。**

> Note: Runtime-supplied UV variables (Channel 2, 3) are defined in
> `RUNTIME_SUPPLIED_UV_VARS` (`agents/shared/constants.ts`). The UV reachability
> validator excludes these from the R-A2 parameter coverage check.

## Section 3: `schemas`

schemas/ ディレクトリの各 .schema.json
ファイルの内容を、ファイル名をキーとして統合する。

```json
"schemas": {
  "issue.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "definitions": {
      "initial.issue": {
        "type": "object",
        "properties": {
          "analysis": { "type": "object" },
          "next_action": {
            "type": "object",
            "properties": {
              "action": {
                "enum": ["next", "repeat"]
              },
              "reason": { "type": "string" }
            },
            "required": ["action", "reason"]
          }
        },
        "required": ["analysis", "next_action"]
      }
    }
  }
}
```

**schemas は既存の JSON Schema そのまま。Blueprint 固有の構文なし。**

## Splitter

Blueprint → 3ファイルの分割は単純な JSON 操作:

```
blueprint.agent    → agent.json
blueprint.registry → steps_registry.json
blueprint.schemas  → schemas/*.schema.json (キーごとに1ファイル)
```

ロジックなし。変換なし。フィールド追加なし。
