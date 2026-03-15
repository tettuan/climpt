# 5. Examples

## Reviewer Agent Blueprint

最も単純な実在エージェント (reviewer) の Blueprint。 5 steps, 2 modes (issue /
default), 共有 closure。

### Blueprint の構造

```mermaid
graph TD
    subgraph "agent section"
        A[agent.name: reviewer]
        P[parameters: issue, iterateMax, branch, baseBranch]
        V[verdict: poll:state]
    end

    subgraph "registry section"
        E[entryStepMapping:<br/>poll:state → initial.issue<br/>count:iteration → initial.default]

        II[initial.issue<br/>uvVars: issue<br/>intents: next, repeat, handoff]
        CI[continuation.issue<br/>uvVars: issue<br/>intents: next, repeat, handoff]

        ID[initial.default<br/>uvVars: project, ...<br/>intents: next, repeat, handoff]
        CD[continuation.default<br/>uvVars: iteration<br/>intents: next, repeat, handoff]

        CR[closure.review<br/>uvVars: [none]<br/>intents: closing, repeat]
    end

    subgraph "schemas section"
        S[reviewer.schema.json<br/>+ common.schema.json]
    end

    E --> II
    E --> ID
    II -->|next| CI
    CI -->|handoff| CR
    ID -->|next| CD
    CD -->|handoff| CR

    A -.->|R-A1: name=agentId| E
    P -.->|R-A2: params ⊇ uvVars| II
    V -.->|R-A3: type ∈ entryStepMapping| E
    II -.->|R-D3: enum=intents| S
```

### 整合性ルールの検証ポイント (reviewer)

| Rule | 検証内容                                   | 具体的な値                                                                                                                                                                                            |
| ---- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-A1 | agent.name = registry.agentId              | `"reviewer"` = `"reviewer"`                                                                                                                                                                           |
| R-A2 | parameters ⊇ uvVariables                   | `{issue, iterateMax, branch, baseBranch}` ⊇ `{issue, project, requirements_label, review_label, iteration}` — **注: project, requirements_label, review_label, iteration は parameters に存在しない** |
| R-A3 | verdict.type ∈ entryStepMapping            | `"poll:state"` ∈ `{"poll:state", "count:iteration"}`                                                                                                                                                  |
| R-B1 | stepId = key                               | 全5 step で一致                                                                                                                                                                                       |
| R-B2 | c2 → stepKind                              | initial→work, continuation→work, closure→closure                                                                                                                                                      |
| R-B3 | intents ⊆ allowed                          | work: {next,repeat,handoff} ⊆ {next,repeat,jump,handoff}                                                                                                                                              |
| R-B4 | transitions.keys = intents                 | 全5 step で一致                                                                                                                                                                                       |
| R-B5 | transition targets ∈ steps                 | continuation.issue, closure.review 等が存在                                                                                                                                                           |
| R-C1 | validator.failurePattern ∈ failurePatterns | git-dirty, branch-not-pushed, branch-not-merged が存在                                                                                                                                                |
| R-D1 | outputSchemaRef.file ∈ schemas             | `"reviewer.schema.json"` ∈ schemas keys                                                                                                                                                               |
| R-D3 | schema.enum = allowedIntents               | initial.issue: `["next","repeat","handoff"]` = schema enum                                                                                                                                            |

### R-A2 の注目点

Reviewer の `initial.default` は
`uvVariables: ["project", "requirements_label", "review_label"]`
を持つが、agent.parameters には `project`, `requirements_label`, `review_label`
がない。

これは **R-A2 違反の可能性** を示す。現状の Runner は UV 変数を CLI args
以外からも供給できる (runtime computed values) ため、厳密な ⊇
チェックは適切でない場合がある。

→ R-A2 は「parameters ⊇ uvVariables (CLI供給分)」に精緻化する必要あり。runtime
供給の UV 変数は Blueprint では別途マークする仕組みが必要。

### Reviewer Blueprint JSON (抜粋)

```json
{
  "$schema": "agent-blueprint.schema.json",

  "agent": {
    "name": "reviewer",
    "displayName": "Reviewer Agent",
    "description": "Autonomous review agent that verifies implementation against requirements",
    "version": "1.12.0",
    "parameters": {
      "issue": {
        "type": "number",
        "required": true,
        "cli": "--issue",
        "description": "GitHub Issue number"
      },
      "iterateMax": {
        "type": "number",
        "required": false,
        "default": 300,
        "cli": "--iterate-max"
      },
      "branch": { "type": "string", "required": false, "cli": "--branch" },
      "baseBranch": {
        "type": "string",
        "required": false,
        "cli": "--base-branch"
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
      "verdict": {
        "type": "poll:state",
        "config": {
          "type": "issueClose",
          "issueParam": "issue",
          "maxIterations": 300
        }
      },
      "boundaries": {
        "allowedTools": [
          "Skill",
          "Read",
          "Glob",
          "Grep",
          "Bash",
          "WebFetch",
          "Task"
        ],
        "permissionMode": "acceptEdits"
      },
      "integrations": {
        "github": {
          "enabled": true,
          "labels": {
            "requirements": "docs",
            "review": "review",
            "gap": "implementation-gap"
          }
        }
      },
      "actions": {
        "enabled": true,
        "types": ["review-action"],
        "outputFormat": "json"
      },
      "execution": { "worktree": { "enabled": true, "root": "../worktree" } },
      "logging": {
        "directory": "tmp/logs/agents/reviewer",
        "format": "jsonl",
        "maxFiles": 100
      }
    }
  },

  "registry": {
    "agentId": "reviewer",
    "version": "3.0.0",
    "c1": "steps",
    "entryStepMapping": {
      "poll:state": "initial.issue",
      "count:iteration": "initial.default"
    },
    "steps": {
      "initial.issue": {
        "stepId": "initial.issue",
        "name": "Issue Review",
        "stepKind": "work",
        "c2": "initial",
        "c3": "issue",
        "edition": "default",
        "fallbackKey": "initial_issue",
        "uvVariables": ["issue"],
        "usesStdin": false,
        "condition": "args.issue !== undefined",
        "priority": 10,
        "outputSchemaRef": {
          "file": "reviewer.schema.json",
          "schema": "initial.issue"
        },
        "structuredGate": {
          "allowedIntents": ["next", "repeat", "handoff"],
          "intentSchemaRef": "#/properties/next_action/properties/action",
          "intentField": "next_action.action",
          "fallbackIntent": "next",
          "handoffFields": ["review.findings", "review.recommendations"]
        },
        "transitions": {
          "next": { "target": "continuation.issue" },
          "repeat": { "target": "initial.issue" },
          "handoff": { "target": "closure.review" }
        }
      },
      "continuation.issue": { "stepId": "continuation.issue", "...": "..." },
      "initial.default": { "stepId": "initial.default", "...": "..." },
      "continuation.default": {
        "stepId": "continuation.default",
        "...": "..."
      },
      "closure.review": {
        "stepId": "closure.review",
        "stepKind": "closure",
        "c2": "closure",
        "c3": "review",
        "structuredGate": {
          "allowedIntents": ["closing", "repeat"],
          "intentSchemaRef": "#/properties/next_action/properties/action",
          "intentField": "next_action.action"
        },
        "transitions": {
          "closing": { "target": null },
          "repeat": { "target": "closure.review" }
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
        "edition": "failed",
        "adaptation": "git-dirty",
        "params": ["changedFiles", "untrackedFiles"]
      }
    },
    "validationSteps": {
      "closure.review": {
        "stepId": "closure.review",
        "name": "Review Validation",
        "c2": "retry",
        "c3": "review",
        "validationConditions": [{ "validator": "git-clean" }],
        "onFailure": { "action": "retry", "maxAttempts": 3 }
      }
    }
  },

  "schemas": {
    "reviewer.schema.json": {
      "initial.issue": {
        "type": "object",
        "properties": {
          "next_action": {
            "properties": {
              "action": { "enum": ["next", "repeat", "handoff"] }
            }
          }
        }
      },
      "closure.review": {
        "type": "object",
        "properties": {
          "next_action": {
            "properties": {
              "action": { "enum": ["closing", "repeat"] }
            }
          }
        }
      }
    }
  }
}
```

## 設計上の発見

### 1. R-A2 は厳密すぎる

UV 変数の供給源は CLI parameters だけではない。runtime computed values
(iteration, completed_iterations 等) も存在する。R-A2 を
`parameters ⊇ uvVariables` とすると、runtime 供給の変数で違反が発生する。

**対応案**: R-A2 を「parameters ⊇ (uvVariables ∩ CLI供給変数)」に修正。runtime
供給変数のリストは Blueprint Schema に embedded enum として持つ。

### 2. condition / priority は Blueprint で表現可能

Reviewer の `condition: "args.issue !== undefined"` と `priority: 10` は step
フィールドとして存在する。Blueprint は Runtime
のフィールドをそのまま書くので、そのまま記載できる。v1 では C5
で禁止していたが、v2 では問題なし。

### 3. schemas セクションの粒度

schemas を Blueprint 内に全て含めると巨大になる。実用上は:

- intent enum 部分のみ Blueprint に含め、R-D3 を検証可能にする
- 完全な schema body は外部ファイルに残す

という折衷案が現実的。検討事項として残す。
