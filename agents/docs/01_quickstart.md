# Agent 作成クイックスタート

設定とプロンプトだけで Agent を作成する手順。

## 前提知識

- Agent = 設定 (JSON) + プロンプト (Markdown)
- コードを書かずに Agent を定義できる
- 詳細: `10_philosophy.md`, `11_core_architecture.md`

## 必要なファイル

```
.agent/{agent-name}/
├── agent.json              # Agent 定義 (必須)
├── steps_registry.json     # Step マッピング (必須)
├── config.json             # ランタイム設定 (任意)
└── prompts/
    ├── system.md           # システムプロンプト
    └── steps/
        ├── initial/        # 初期フェーズ
        │   └── {c3}/
        │       └── f_default.md
        ├── continuation/   # 継続フェーズ
        │   └── {c3}/
        │       └── f_default.md
        └── complete/       # 完了フェーズ
            └── {c3}/
                └── f_default.md
```

## Step 1: ディレクトリ作成

```bash
AGENT_NAME=my-agent
mkdir -p .agent/${AGENT_NAME}/prompts/steps/{initial,continuation,complete}/default
mkdir -p .agent/${AGENT_NAME}/schemas
```

## Step 2: agent.json 作成

`.agent/{agent-name}/agent.json`:

```json
{
  "version": "1.10.0",
  "name": "my-agent",
  "displayName": "My Agent",
  "description": "Agent の説明",

  "behavior": {
    "systemPromptPath": "prompts/system.md",
    "completionType": "externalState",
    "completionConfig": {
      "maxIterations": 50
    },
    "allowedTools": ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
    "permissionMode": "bypassPermissions"
  },

  "parameters": {
    "issue": {
      "type": "number",
      "description": "GitHub Issue 番号",
      "required": true,
      "cli": "--issue"
    }
  },

  "prompts": {
    "registry": "steps_registry.json",
    "fallbackDir": "prompts/"
  },

  "logging": {
    "directory": "tmp/logs/agents/my-agent",
    "format": "jsonl"
  }
}
```

### completionType の選択

| タイプ            | 用途                | 設定                  |
| ----------------- | ------------------- | --------------------- |
| `externalState`   | Issue/PR の状態監視 | `maxIterations`       |
| `iterationBudget` | 固定回数で終了      | `maxIterations`       |
| `keywordSignal`   | キーワードで終了    | `completionKeyword`   |
| `stepMachine`     | Step グラフで判定   | `steps_registry.json` |

詳細: `02_agent_definition.md`

## Step 3: steps_registry.json 作成

`.agent/{agent-name}/steps_registry.json`:

```json
{
  "$schema": "../../agents/schemas/steps_registry.schema.json",
  "agentId": "my-agent",
  "version": "3.0.0",
  "userPromptsBase": ".agent/my-agent/prompts",
  "schemasBase": ".agent/my-agent/schemas",

  "c1": "steps",
  "pathTemplate": "{c1}/{c2}/{c3}/f_{edition}.md",

  "entryStepMapping": {
    "issue": "initial.default",
    "default": "initial.default"
  },

  "steps": {
    "initial.default": {
      "stepId": "initial.default",
      "name": "Initial Prompt",
      "c2": "initial",
      "c3": "default",
      "edition": "default",
      "fallbackKey": "default_initial",
      "structuredGate": {
        "allowedIntents": ["next", "repeat", "complete"],
        "intentField": "next_action.action",
        "fallbackIntent": "next",
        "handoffFields": ["analysis", "plan"]
      },
      "transitions": {
        "next": { "target": "continuation.default" },
        "repeat": { "target": "initial.default" },
        "complete": { "target": "complete.default" }
      }
    },
    "continuation.default": {
      "stepId": "continuation.default",
      "name": "Continuation Prompt",
      "c2": "continuation",
      "c3": "default",
      "edition": "default",
      "structuredGate": {
        "allowedIntents": ["next", "repeat", "complete"],
        "intentField": "next_action.action",
        "fallbackIntent": "next",
        "handoffFields": ["progress"]
      },
      "transitions": {
        "next": { "target": "continuation.default" },
        "repeat": { "target": "continuation.default" },
        "complete": { "target": "complete.default" }
      }
    },
    "complete.default": {
      "stepId": "complete.default",
      "name": "Completion Step",
      "c2": "complete",
      "c3": "default",
      "edition": "default"
    }
  }
}
```

### 重要な設定

| 設定               | 役割                    |
| ------------------ | ----------------------- |
| `entryStepMapping` | 入力タイプ → 初期 Step  |
| `structuredGate`   | AI 応答から intent 抽出 |
| `transitions`      | intent → 次の Step      |
| `handoffFields`    | 次 Step へ渡すデータ    |

詳細: `step_flow_design.md`

## Step 4: システムプロンプト作成

`.agent/{agent-name}/prompts/system.md`:

````markdown
# My Agent

あなたは {役割} です。

## 目標

- {目標1}
- {目標2}

## 制約

- {制約1}
- {制約2}

## 出力形式

必ず以下の JSON 形式で回答してください:

```json
{
  "analysis": "分析内容",
  "plan": ["ステップ1", "ステップ2"],
  "next_action": {
    "action": "continue | complete | retry",
    "reason": "理由"
  }
}
```
````

````
## Step 5: Step プロンプト作成

### Initial プロンプト

`.agent/{agent-name}/prompts/steps/initial/default/f_default.md`:

```markdown
---
stepId: initial.default
name: Initial Prompt
uvVariables:
  - issue_number
---

# タスク開始

Issue #{uv-issue_number} に取り組みます。

## 指示

1. Issue の内容を理解する
2. 実装計画を立てる
3. 作業を開始する

## 出力

分析結果と計画を JSON で出力してください。
````

### Continuation プロンプト

`.agent/{agent-name}/prompts/steps/continuation/default/f_default.md`:

```markdown
---
stepId: continuation.default
name: Continuation Prompt
---

# 継続

前回の作業を継続します。

## 前回の状態

{previous_summary}

## 指示

1. 残りの作業を確認
2. 次のステップを実行
3. 完了したら `complete` を出力

## 出力

進捗と次のアクションを JSON で出力してください。
```

## Step 6: 実行

```bash
# Agent 一覧
deno run -A agents/scripts/run-agent.ts --list

# 実行
deno run -A agents/scripts/run-agent.ts \
  --agent my-agent \
  --issue 123

# オプション
#   --max-iterations 10    最大反復回数
#   --dry-run              実行せずに設定確認
#   --verbose              詳細ログ
```

## テンプレート変数

### UV 変数 (User Variables)

プロンプト内で `{uv-変数名}` 形式で使用:

```markdown
Issue #{uv-issue_number} の作業 プロジェクト: {uv-project_title}
```

Climpt の breakdown サービスが解決する。

### カスタム変数

Agent ロジックが注入する変数:

- `{previous_summary}` - 前回の要約
- `{issue_content}` - Issue 本文
- `{project_context_section}` - プロジェクト情報

## Intent マッピング

AI の `next_action.action` から遷移を決定:

| AI 応答    | Intent     | 動作               |
| ---------- | ---------- | ------------------ |
| `continue` | `next`     | 次の Step へ       |
| `complete` | `complete` | 完了               |
| `retry`    | `repeat`   | 同じ Step を再実行 |
| `escalate` | `abort`    | 中断               |

詳細: `step_flow_design.md`

## 既存 Agent の参考

| Agent       | 特徴               | 場所                  |
| ----------- | ------------------ | --------------------- |
| iterator    | 複雑な Step フロー | `.agent/iterator/`    |
| reviewer    | シンプルなレビュー | `.agent/reviewer/`    |
| facilitator | マルチ Agent 連携  | `.agent/facilitator/` |

## トラブルシューティング

### Agent が見つからない

```
Error: Agent 'my-agent' not found
```

→ `.agent/my-agent/agent.json` が存在するか確認

### Step が見つからない

```
Error: Step 'initial.default' not found in registry
```

→ `steps_registry.json` の `steps` に定義があるか確認

### プロンプトが見つからない

```
Error: Prompt file not found: prompts/steps/initial/default/f_default.md
```

→ C3L パス (`{c1}/{c2}/{c3}/f_{edition}.md`) に従ってファイルを配置

### 遷移エラー

```
[StepFlow] No routed step ID for iteration N.
```

→ Step に `structuredGate` と `transitions` を定義

## 次のステップ

- `02_agent_definition.md` - agent.json の詳細
- `05_prompt_system.md` - C3L プロンプト解決
- `step_flow_design.md` - Step フロー設計
- `08_structured_outputs.md` - Structured Output
