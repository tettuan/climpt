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
    "completionType": "iterate | manual | issue | project | custom",
    "completionConfig": { "..." },
    "allowedTools": ["Read", "Write", "Edit", "Bash"],
    "permissionMode": "plan | acceptEdits | bypassPermissions"
  }
}
```

### completionType

| タイプ    | 完了条件                    | 必須設定                 |
| --------- | --------------------------- | ------------------------ |
| `iterate` | 指定回数実行後              | `maxIterations: number`  |
| `manual`  | キーワード出力              | `completionKeyword: str` |
| `issue`   | GitHub Issue クローズ       | なし（CLI で指定）       |
| `project` | GitHub Project フェーズ終了 | なし（CLI で指定）       |
| `custom`  | カスタムハンドラ            | `handlerPath: string`    |

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

### actions

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

### github / worktree

外部連携（省略可）。

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
```
