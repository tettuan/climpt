# Agent 作成クイックスタート

設定とプロンプトだけで Agent を作成する手順。

## 作成方法の選択

### 方法 1: Scaffolder Plugin（推奨）

まず Plugin をインストール:

```bash
# Marketplace 追加（初回のみ）
/plugin marketplace add tettuan/climpt

# Plugin インストール
/plugin install climpt-agent-scaffolder
```

Claude Code で以下のいずれかを実行:

- 「agent を作りたい」
- 「新しい agent を作成」
- 「create agent」

Skill が agent 名や completionType を質問し、必要なファイルを自動生成します。

#### CLI から直接実行

```bash
# Plugin インストール後
deno run -A ${CLAUDE_PLUGIN_ROOT}/skills/agent-scaffolder/scripts/scaffold.ts \
  --name my-agent \
  --description "My agent description" \
  --completion-type externalState

# オプション
#   --dry-run              生成内容をプレビュー
#   --display-name "Name"  表示名を指定
```

> **開発者向け**: このリポジトリ内で作業している場合は
> `plugins/climpt-agent-scaffolder/skills/agent-scaffolder/scripts/scaffold.ts`
> から直接実行可能。

### 方法 2: 手動作成

以下の Step 1〜6 に従って手動でファイルを作成します。

---

## 前提知識

- Agent = 設定 (JSON) + プロンプト (Markdown)
- コードを書かずに Agent を定義できる
- 詳細: `design/04_philosophy.md`, `design/05_core_architecture.md`

## 必要なファイル

```
.agent/{agent-name}/
├── agent.json              # Agent 定義 (必須)
├── steps_registry.json     # Step マッピング (必須)
├── config.json             # ランタイム設定 (任意)
└── prompts/
    ├── system.md           # システムプロンプト
    └── steps/
        ├── initial/        # Work Step: 初期フェーズ
        │   └── {c3}/
        │       └── f_default.md
        ├── continuation/   # Work Step: 継続フェーズ
        │   └── {c3}/
        │       └── f_default.md
        ├── verification/   # Verification Step: 検証フェーズ
        │   └── {c3}/
        │       └── f_default.md
        └── closure/        # Closure Step: 完了フェーズ
            └── {c3}/
                └── f_default.md
```

### Step 種別 (Step Taxonomy)

| 種別              | パターン                       | 責務         | 許可 Intent                          |
| ----------------- | ------------------------------ | ------------ | ------------------------------------ |
| Work Step         | `initial.*` / `continuation.*` | 成果物を生成 | `next`, `repeat`, `jump`, `handoff`  |
| Verification Step | `verification.*`               | 成果物を検証 | `next`, `repeat`, `jump`, `escalate` |
| Closure Step      | `closure.*`                    | 完了判定     | `closing`, `repeat`                  |

> **Rule**: Work Step は `closing` を返さない。作業が完了したら `handoff` で
> Closure Step に遷移する。Closure Step のみが `closing` を返せる。

## Step 1: ディレクトリ作成

```bash
AGENT_NAME=my-agent
mkdir -p .agent/${AGENT_NAME}/prompts/steps/{initial,continuation,verification,closure}/default
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

#### Runner の検証

- `entryStepMapping` または `entryStep` が未設定だと
  `No entry step configured for completionType "stepMachine"` で即中断する。
- Flow Step に `structuredGate`/`transitions` が無い場合は
  `Flow validation failed. All Flow steps must define structuredGate and transitions.`
  が表示される。
- `outputSchemaRef` が無い、または `schema` の JSON Pointer が解決できない場合は
  初回 iteration の直前に Runner が停止し、次のようなメッセージを出す:

  ```
  [StepFlow] Schema resolution failed for step "initial.default".
  Check step_outputs.schema.json#/definitions/initial.default
  ```

- 同じ Step で Schema 解決が 2 回連続で失敗すると、Flow を即終了し
  `FAILED_SCHEMA_RESOLUTION` ステータスで落ちる（無限ループは発生しない）。

- Iteration > 1 で intent が生成されない場合（structured output がない、または
  `next_action.action` が解析できない場合）、Flow は即座に中断する:

  ```
  [StepFlow] No intent produced for iteration 3 on step "continuation.default".
  Flow steps must produce structured output with a valid intent.
  Check that the step's schema includes next_action.action and the LLM returns valid JSON.
  ```

この順番で埋めておけば、必須条件を満たしていない場合は Runner がエラーで止まり、
ドキュメントを読み返さなくても原因が明示される。

### completionType の選択

| タイプ            | 用途                | 設定                  |
| ----------------- | ------------------- | --------------------- |
| `externalState`   | Issue/PR の状態監視 | `maxIterations`       |
| `iterationBudget` | 固定回数で終了      | `maxIterations`       |
| `keywordSignal`   | キーワードで終了    | `completionKeyword`   |
| `stepMachine`     | Step グラフで判定   | `steps_registry.json` |

詳細: `02_agent_definition.md`

## Step 3: steps_registry.json 作成

`.agent/{agent-name}/steps_registry.json`
を作るときは、**以下の3点を満たしていれば Runner
がそのまま受け入れてくれる**という順番で作業する。

1. `entryStepMapping` で `completionType` ごとの開始 Step を明示する
2. すべての Flow/Completion Step に `structuredGate` と `transitions` を持たせる
3. 同じ Step に `outputSchemaRef` を付け、`schema` には JSON Pointer
   (`#/definitions/<stepId>`) を記載して後述の Schema ファイルへ誘導する

どれか 1 つでも欠けると Runner
のロード段階で即エラーになるため、上から順に埋めれば迷わない。

完成形は次のとおり:

````json
{

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
    "default": "initial.default",
    "stepMachine": "initial.default"
  },

  "steps": {
    "initial.default": {
      "stepId": "initial.default",
      "stepKind": "work",
      "name": "Initial Prompt",
      "c2": "initial",
      "c3": "default",
      "edition": "default",
      "fallbackKey": "default_initial",
      "outputSchemaRef": {
        "file": "step_outputs.schema.json",
        "schema": "#/definitions/initial.default"
      },
      "structuredGate": {
        "allowedIntents": ["next", "repeat"],
        "intentField": "next_action.action",
        "intentSchemaRef": "#/definitions/initial.default/properties/next_action/properties/action",
        "failFast": true,
        "handoffFields": ["analysis", "plan"]
      },
      "transitions": {
        "next": { "target": "continuation.default" },
        "repeat": { "target": "initial.default" }
      }
    },
    "continuation.default": {
      "stepId": "continuation.default",
      "stepKind": "work",
      "name": "Continuation Prompt",
      "c2": "continuation",
      "c3": "default",
      "edition": "default",
      "outputSchemaRef": {
        "file": "step_outputs.schema.json",
        "schema": "#/definitions/continuation.default"
      },
      "structuredGate": {
        "allowedIntents": ["next", "repeat", "handoff"],
        "intentField": "next_action.action",
        "intentSchemaRef": "#/definitions/continuation.default/properties/next_action/properties/action",
        "failFast": true,
        "handoffFields": ["progress"]
      },
      "transitions": {
        "next": { "target": "verification.default" },
        "repeat": { "target": "continuation.default" },
        "handoff": { "target": "closure.default" }
      }
    },
    "verification.default": {
      "stepId": "verification.default",
      "stepKind": "verification",
      "name": "Verification Step",
      "c2": "verification",
      "c3": "default",
      "edition": "default",
      "outputSchemaRef": {
        "file": "step_outputs.schema.json",
        "schema": "#/definitions/verification.default"
      },
      "structuredGate": {
        "allowedIntents": ["next", "repeat", "escalate"],
        "intentField": "next_action.action",
        "intentSchemaRef": "#/definitions/verification.default/properties/next_action/properties/action",
        "failFast": true,
        "handoffFields": ["verification_result"]
      },
      "transitions": {
        "next": { "target": "closure.default" },
        "repeat": { "target": "continuation.default" },
        "escalate": { "target": "continuation.default" }
      }
    },
    "closure.default": {
      "stepId": "closure.default",
      "stepKind": "closure",
      "name": "Closure Step",
      "c2": "closure",
      "c3": "default",
      "edition": "default",
      "outputSchemaRef": {
        "file": "step_outputs.schema.json",
        "schema": "#/definitions/closure.default"
      },
      "structuredGate": {
        "allowedIntents": ["closing", "repeat"],
        "intentField": "next_action.action",
        "intentSchemaRef": "#/definitions/closure.default/properties/next_action/properties/action",
        "failFast": true,
        "handoffFields": ["final_summary"]
      },
      "transitions": {
        "closing": { "target": null },
        "repeat": { "target": "continuation.default" }
      }
    }
  }
}
````

### Structured Output Schema の用意

Flow ループは Structured Output を前提に `next_action.action` から intent を
読み取る。したがって **すべての Flow/Completion Step が `outputSchemaRef`
を宣言し、`schema` には JSON Pointer (`#/definitions/<stepId>`) を設定し、 JSON
Schema を `.agent/{agent}/schemas/` に置く**。

```
.agent/{agent}/schemas/
└── step_outputs.schema.json
```

`step_outputs.schema.json` は次のように `definitions`（または `$defs`）配下へ
Step ごとのスキーマを配置し、Flow から参照される。

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "./step_outputs.schema.json",
  "definitions": {
    "initial.default": {
      "type": "object",
      "properties": {
        "analysis": { "type": "object" },
        "next_action": {
          "type": "object",
          "properties": {
            "action": { "enum": ["next", "repeat"] },
            "reason": { "type": "string" }
          },
          "required": ["action", "reason"],
          "additionalProperties": false
        }
      },
      "required": ["analysis", "next_action"],
      "additionalProperties": false
    }
  }
}
```

Pointer 形式 (`#/definitions/initial.default`)
とファイル上の定義が一致しない場合、 Runner は「Schema resolution
failed」で即停止する。

### Fail-Fast 動作

- Schema 参照が見つからない／ファイルが欠落している場合、該当 Step の iteration
  は 実行されず `StructuredOutputUnavailable` として扱われる。
- 同じ Step で 2 回連続して Schema 解決に失敗すると、Flow 全体を停止し
  `FAILED_SCHEMA_RESOLUTION` を返す。これにより無限ループを防ぐ。
- 完了に必要な node (`structuredGate.intentField` など) が Schema
  に含まれていない 場合も同様に停止させるのが推奨。

`step_outputs.schema.json` の例:

```jsonc
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "./step_outputs.schema.json",
  "definitions": {
    "initial.default": {
      "type": "object",
      "required": ["next_action"],
      "properties": {
        "analysis": { "type": "object" },
        "next_action": {
          "type": "object",
          "required": ["action"],
          "properties": {
            "action": { "enum": ["next", "repeat"] }
          },
          "additionalProperties": false
        }
      },
      "additionalProperties": false
    }
  }
}
```

`structuredGate.intentField` は Schema に沿って JSON を強制できることを前提に
している。Schema がない Step はロード時エラーになるよう runner 側でも検証
する想定である。また `structuredGate.intentSchemaRef` は `next_action.action`
など intent enum を定義するノードへしか張れない。`allowedIntents` に無い 値や
enum の余剰はロード時点で検出されるため、Step を追加／改名したときは
両方のポインタを必ず更新する。

### Completion の考え方

- Flow が終了する条件は **Structured Output で `next_action.action` を `closing`
  に設定すること**。`isTerminal` のような暗黙フラグは Runner では参照されない。
- Schema が SDK の `formatted` オプションで渡されるため、プロンプトに JSON
  形式の指示は不要。プロンプトは意味的な指示に集中する。
- `transitions.closing.target` に `null` を明示すると、WorkflowRouter が
  completion と判定し Completion Loop へ制御を渡す。

### Boundary Hook

Closure Step が `closing` intent を返した瞬間にだけ起動するフック機構。

- **目的**: Issue close、Release 作成などの外部副作用を安全に実行
- **保証**: Work / Verification Step は `closing` を返せないため、
  誤って外部操作が実行されることを物理的に防ぐ
- **実装**: Schema / Gate が `closing` を禁止している限り Boundary Hook
  は呼び出されない

```
Flow 終了シーケンス:
  Closure Step → closing intent → Boundary Hook → Completion Loop
```

詳細: `design/08_step_flow_design.md` Section 7.1

### 重要な設定

| 設定               | 役割                    |
| ------------------ | ----------------------- |
| `entryStepMapping` | 入力タイプ → 初期 Step  |
| `structuredGate`   | AI 応答から intent 抽出 |
| `transitions`      | intent → 次の Step      |
| `handoffFields`    | 次 Step へ渡すデータ    |

#### structuredGate フィールド

| フィールド        | 必須 | 説明                                                                                           |
| ----------------- | ---- | ---------------------------------------------------------------------------------------------- |
| `allowedIntents`  | Yes  | このステップで許可される intent 配列 (`stepKind` ごとの上限に一致)                             |
| `intentField`     | Yes  | AI 出力から intent を読み取るパス (e.g. `next_action.action`) ※欠落時はロードで失敗            |
| `intentSchemaRef` | Yes  | intent enum への JSON Pointer。Schema enum と `allowedIntents` の差異はロードで失敗            |
| `failFast`        | Yes* | 既定 `true`。プロダクションでは必須。デバッグで `false` にする場合は Spec Violation ログが出る |
| `handoffFields`   | No   | 次ステップへ引き継ぐフィールド名配列                                                           |

`*` failFast を `false` にできるのは一時的な検証作業のみ。Flow
を本番投入する際は `true` に戻し、fallbackIntent を設定していても Runner
が停止することを前提にする。

詳細: `design/08_step_flow_design.md`

## Step 4: システムプロンプト作成

`.agent/{agent-name}/prompts/system.md`:

Schema が structured output を強制するため、JSON 形式の指示は不要。
意味的な指示（役割、目標、制約、アクションの意味）に集中する。

```markdown
# My Agent

あなたは {役割} です。

## 目標

- {目標1}
- {目標2}

## 制約

- {制約1}
- {制約2}

## アクションの意味

| Action    | 使用タイミング                  |
| --------- | ------------------------------- |
| `next`    | 次のステップに進む              |
| `repeat`  | 現在のステップを再試行          |
| `closing` | タスク完了（closure step のみ） |
```

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
```

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
3. 完了したら closure へ進む
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

## entryStepMapping Requirements

`completionType` に応じて、`entryStepMapping` に必要なキーを定義する。
不足しているとロード時にエラーになる。

| completionType  | Required entryStepMapping key |
| --------------- | ----------------------------- |
| `externalState` | `externalState`               |
| `issue`         | `issue`                       |
| `iterate`       | `iterate`                     |
| `stepMachine`   | `stepMachine`                 |
| `default`       | `default`                     |

例: `completionType: "externalState"` の場合:

```json
"entryStepMapping": {
  "externalState": "initial.default",
  "default": "initial.default"
}
```

## Intent マッピング

AI の `next_action.action` から遷移を決定。Step 種別ごとに許可される intent
が異なる:

### Work Step (`initial.*` / `continuation.*`)

| Intent   | 動作                 |
| -------- | -------------------- |
| `next`   | 次の Step へ         |
| `repeat` | 同じ Step を再実行   |
| `jump`   | 指定 Step へジャンプ |

> **Rule**: Work Step は `closing` を返さない。

### Verification Step (`verification.*`)

| Intent     | 動作                             |
| ---------- | -------------------------------- |
| `next`     | 次の Step へ                     |
| `repeat`   | 検証対象 Step へ戻る             |
| `jump`     | 指定 Step へジャンプ             |
| `escalate` | サポート Step へエスカレーション |

> **Rule**: Verification Step は `closing` を返さない。`escalate`
> は静的定義された Step のみに遷移。

### Closure Step (`closure.*`)

| Intent    | 動作                          |
| --------- | ----------------------------- |
| `closing` | Flow 終了、Boundary Hook 実行 |
| `repeat`  | 作業 Step へ戻る              |

> **Rule**: `closing` を宣言できるのは Closure Step のみ。

詳細: `design/08_step_flow_design.md`

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

---

## 関連ドキュメント

| ドキュメント                                                          | 内容               |
| --------------------------------------------------------------------- | ------------------ |
| [02_agent_definition.md](./02_agent_definition.md)                    | agent.json の詳細  |
| [03_builder_guide.md](./03_builder_guide.md)                          | 設計思想と連鎖     |
| [04_config_system.md](./04_config_system.md)                          | 設定の優先順位     |
| [design/02_prompt_system.md](../design/02_prompt_system.md)           | C3L プロンプト解決 |
| [design/03_structured_outputs.md](../design/03_structured_outputs.md) | Structured Output  |
| [design/08_step_flow_design.md](../design/08_step_flow_design.md)     | Step Flow 設計     |
