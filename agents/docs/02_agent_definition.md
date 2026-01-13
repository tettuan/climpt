# Agent 定義

agent.json で Agent の振る舞いを宣言する。

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

### completionType

| タイプ            | 完了条件                   | 必須設定                    |
| ----------------- | -------------------------- | --------------------------- |
| `externalState`   | 外部状態の検証（Issue 等） | `validators` 参照           |
| `iterationBudget` | 指定回数実行後             | `maxIterations: number`     |
| `keywordSignal`   | キーワード出力             | `completionKeyword: string` |
| `composite`       | 複数条件の組み合わせ       | `completionConditions` 配列 |

### completionConditions

steps_registry.json で完了条件を定義する。詳細は `08_structured_outputs.md`
を参照。

```json
{
  "steps": {
    "complete.issue": {
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

CLI 引数の定義。

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

### actions（廃止予定）

> **注意**: アクションシステムは廃止予定です。
> 完了条件検証（`completionConditions`）への移行を推奨します。 詳細は
> `06_action_system.md` および `08_structured_outputs.md` を参照。

アクション検出（省略可）。

```json
{
  "actions": {
    "enabled": true,
    "types": ["decision", "action-item"],
    "outputFormat": "agent-action"
  }
}
```

現行 Runner はまだ `actions/` ディレクトリのコードを読み込んでいますが、
完了判定は `completionConditions` で行うことを推奨します。

### github / worktree

外部連携（省略可）。

> **現状**: worktree 機能は実装済みですが、CLI との統合が未完了です。
> `--branch`, `--base-branch`
> オプションはパースされますが、実行には反映されません。 統合完了までは手動で
> worktree を設定してください。

```json
{
  "github": { "enabled": true },
  "worktree": { "enabled": true, "root": ".worktrees" }
}
```

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
