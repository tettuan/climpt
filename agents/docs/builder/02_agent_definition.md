# Agent 定義

agent.json で Agent
の振る舞いを宣言する。`docs/internal/ai-complexity-philosophy.md`
が説く「意図的な単純化」の原則に従い、What/Why を先に決めてから How
（設定値）を埋めるという姿勢を崩さない。

## 構造

```json
{
  "name": "識別子",
  "displayName": "表示名",
  "description": "説明",
  "behavior": { "..." },
  "parameters": { "..." },
  "prompts": { "..." },
  "logging": { "..." }
}
```

## behavior

Agent の振る舞い。

```json
{
  "behavior": {
    "systemPromptPath": "prompts/system.md",
    "completionType": "externalState | iterationBudget | keywordSignal | composite",
    "completionConfig": { "..." },
    "allowedTools": ["Read", "Write", "Edit", "Bash"],
    "permissionMode": "plan | acceptEdits | bypassPermissions"
  }
}
```

### defaultModel

使用するモデルのデフォルト値。省略時は `opus`（システムデフォルト）。

```json
{
  "behavior": {
    "defaultModel": "sonnet"
  }
}
```

| 値       | 説明                           |
| -------- | ------------------------------ |
| `opus`   | 最高性能（システムデフォルト） |
| `sonnet` | 高性能・バランス               |
| `haiku`  | 高速・低コスト                 |

**通常は設定不要**。opus がデフォルトのため、エージェント全体で異なるモデルを
使いたい場合のみ指定する。ステップごとの指定は `steps_registry.json` で行う。

詳細: [design/09_model_selection.md](../design/09_model_selection.md)

### completionType

| タイプ             | What                                      | Why                                                       | 主な設定                                                           |
| ------------------ | ----------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------ |
| `externalState`    | Issue や git 等の外部状態と同期           | 1 Issue = 1 Branch = 1 Worktree の境界を守るため          | `validators`, `github`, `worktree`, **parameters に `issue` 必須** |
| `iterationBudget`  | 所定回数の iteration で終了               | ループを有限に保ち暴走を防ぐ                              | `maxIterations`                                                    |
| `checkBudget`      | Status check の回数で終了                 | 監視用途で「回数 = コスト」を明示し、作業計画を単純化     | `maxChecks`                                                        |
| `keywordSignal`    | 指定キーワードを Structured Output で出す | LLM の宣言を Completion Loop へ透過させる                 | `completionKeyword`                                                |
| `structuredSignal` | JSON schema で完了宣言を受け取る          | フリーテキスト依存を無くし、FormatValidator で収束を担保  | `responseFormat`, `outputSchema`                                   |
| `stepMachine`      | 事前に定義した step graph で判定          | Flow ループの遷移と Completion 判定を同じ図面で語れるため | `steps_registry.json`                                              |
| `composite`        | 複数条件 (any/all) の合成                 | 高凝集のまま複雑な契約を表現し、AI の局所最適を減らす     | `completionConditions`, `mode`                                     |
| `custom`           | 外部 CompletionHandler で任意判定         | 特殊案件を外付けストラテジに押し出し、コアを汚さない      | カスタム factory, `completionHandler` 設定                         |

### completionConditions

steps_registry.json で完了条件を定義する。詳細は
`design/03_structured_outputs.md` を参照。

```json
{
  "steps": {
    "closure.issue": {
      "completionConditions": [
        { "validator": "git-clean" },
        { "validator": "tests-pass" }
      ],
      "onFailure": {
        "action": "retry",
        "maxAttempts": 3
      }
    }
  }
}
```

## parameters

CLI 引数の定義。`run-agent.ts`
はここに宣言されたパラメータのみをランナーに転送する。 **宣言されていない CLI
引数は無視される。**

```json
{
  "parameters": {
    "topic": {
      "type": "string",
      "description": "セッショントピック",
      "required": true,
      "cli": "--topic"
    },
    "maxIterations": {
      "type": "number",
      "default": 10,
      "cli": "--max-iterations"
    }
  }
}
```

### completionType 別の必須パラメータ

| completionType  | 必須パラメータ | 説明                                      |
| --------------- | -------------- | ----------------------------------------- |
| `externalState` | `issue`        | GitHub Issue 番号。未宣言だと実行時エラー |

`externalState` を使う場合、以下を `parameters` に含めること:

```json
{
  "parameters": {
    "issue": {
      "type": "number",
      "description": "GitHub Issue number",
      "required": true,
      "cli": "--issue"
    }
  }
}
```

## prompts

プロンプト解決の設定。

```json
{
  "prompts": {
    "registry": "steps_registry.json",
    "fallbackDir": "prompts/"
  }
}
```

## logging

ログ設定。

```json
{
  "logging": {
    "directory": "tmp/logs/agents/{name}",
    "format": "jsonl"
  }
}
```

## オプション

### github / worktree

外部連携（省略可）。`agents/scripts/run-agent.ts` が worktree の生成と
`--branch` / `--base-branch` を既に解決しており、Issue ごとに
孤立した作業空間を用意できる。

```json
{
  "github": {
    "enabled": true,
    "labels": {
      "requirements": "docs",
      "inProgress": "in-progress",
      "blocked": "need clearance",
      "completion": {
        "add": ["done"],
        "remove": ["in-progress"]
      }
    },
    "defaultClosureAction": "close"
  },
  "worktree": {
    "enabled": true,
    "root": ".worktrees"
  }
}
```

#### github.labels.completion

Issue 完了時に自動適用するラベル設定。

| フィールド | 説明                   |
| ---------- | ---------------------- |
| `add`      | 完了時に追加するラベル |
| `remove`   | 完了時に削除するラベル |

#### github.defaultClosureAction

Issue 完了時のデフォルトアクション。AI の structured output で上書き可能。

| 値                | 説明                                 |
| ----------------- | ------------------------------------ |
| `close`           | Issue をクローズ（デフォルト）       |
| `label-only`      | ラベル変更のみ、Issue は OPEN のまま |
| `label-and-close` | ラベル変更後に Issue をクローズ      |

**優先順位**: AI structured output > `defaultClosureAction` > `"close"`

**Multi-agent ワークフローでの使い分け**

複数の Agent が連携するワークフローでは、最終 Agent 以外は `label-only`
を使用する。

```
Analyst (label-only) → Architect (label-only) → Writer (label-only) → Facilitator (close)
```

| Agent の役割 | 推奨値       | 理由                                      |
| ------------ | ------------ | ----------------------------------------- |
| 中間 Agent   | `label-only` | Issue を OPEN のまま次の Agent へ引き継ぐ |
| 最終 Agent   | `close`      | ワークフロー完了時に Issue をクローズ     |

> **注意**: デフォルト値は `close` のため、中間 Agent で明示的に `label-only` を
> 設定しないと、意図せず Issue がクローズされる。 → トラブルシューティング:
> [Issue が意図せず close される](05_troubleshooting.md#issue-が意図せず-close-される)

**Prompt 層への影響**

`defaultClosureAction` は Boundary Hook だけでなく、Prompt 生成にも反映される。

| 設定値            | `buildCompletionCriteria().short` | Prompt のクローズ指示      |
| ----------------- | --------------------------------- | -------------------------- |
| `close`           | `Close Issue #N`                  | `"close it when done"`     |
| `label-only`      | `Complete phase for Issue #N`     | `"Do NOT close the issue"` |
| `label-and-close` | `Issue #N labeled and closed`     | `"close it when done"`     |

`label-only` の場合、フォールバックプロンプト（`buildInitialPrompt()` /
`buildContinuationPrompt()`）も `"action":"close"` の代わりに
`"action":"complete"` を使用し、エージェントに phase 完了のみを指示する。

### finalize

Flow ループ完了後のワークツリー処理を制御する。`finalizeWorktreeBranch`
シーケンス（merge → push → PR → cleanup）の挙動を定義する。

```json
{
  "finalize": {
    "autoMerge": true,
    "push": false,
    "remote": "origin",
    "createPr": false,
    "prTarget": "main"
  }
}
```

| フィールド  | デフォルト | 説明                                  |
| ----------- | ---------- | ------------------------------------- |
| `autoMerge` | `true`     | worktree ブランチをベースへ自動マージ |
| `push`      | `false`    | マージ後にリモートへプッシュ          |
| `remote`    | `"origin"` | プッシュ先のリモート                  |
| `createPr`  | `false`    | 直接マージではなく PR を作成          |
| `prTarget`  | ベース     | PR のターゲットブランチ               |

CLI オプションでオーバーライド可能:

- `--no-merge`: autoMerge を無効化
- `--push`: push を有効化
- `--push-remote <name>`: リモート指定
- `--create-pr`: PR 作成モード
- `--pr-target <branch>`: PR ターゲット指定

## ディレクトリ構造

```
.agent/{agent-name}/
├── agent.json
├── config.json          # 実行時設定（省略可）
├── steps_registry.json
└── prompts/
    ├── system.md
    └── steps/...        # C3L 構造
```

## 検証

起動時に検証される。

```
load(path) → parse → validate → 起動 or エラー

検証項目:
- 必須フィールドの存在
- completionConfig と completionType の整合性
- 参照ファイルの存在
- completionConditions の validator 参照の妥当性
```

---

## 注意点

| 項目               | 注意                                           |
| ------------------ | ---------------------------------------------- |
| `completionType`   | 8 種類のみ有効。レガシー名は廃止済み           |
| `systemPromptPath` | agent.json からの相対パス                      |
| `allowedTools`     | 許可されていないツールは実行時エラー           |
| `permissionMode`   | `bypassPermissions` は信頼できる環境でのみ使用 |

---

## 関連ドキュメント

| ドキュメント                                                          | 内容                        |
| --------------------------------------------------------------------- | --------------------------- |
| [01_quickstart.md](./01_quickstart.md)                                | ファイル作成手順            |
| [03_builder_guide.md](./03_builder_guide.md)                          | 設計思想と連鎖              |
| [04_config_system.md](./04_config_system.md)                          | 設定の優先順位              |
| [design/03_structured_outputs.md](../design/03_structured_outputs.md) | completionConditions の詳細 |
| [design/09_model_selection.md](../design/09_model_selection.md)       | モデル選択の設計            |
