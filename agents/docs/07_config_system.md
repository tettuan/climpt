# 設定システム

複数レイヤーの設定をマージして適用。上位が下位を上書き。

## 優先順位

```
高  CLI 引数
 ↓  config.json（実行時設定）
 ↓  agent.json（Agent 定義）
低  パッケージデフォルト
```

## ファイル構成

```
.agent/{agent-name}/
├── agent.json           # Agent 定義（コミット対象）
├── config.json          # 実行時設定（省略可、gitignore 可）
└── config.local.json    # ローカル設定（gitignore）
```

## agent.json

Agent の振る舞いを定義。変更頻度: 低。

```json
{
  "version": "1.0.0",
  "name": "facilitator",
  "displayName": "Facilitator Agent",
  "behavior": {
    "systemPromptPath": "prompts/system.md",
    "completionType": "manual",
    "completionConfig": { "completionKeyword": "SESSION_COMPLETE" },
    "allowedTools": ["Read", "Write", "Edit", "Bash"],
    "permissionMode": "acceptEdits"
  },
  "parameters": { "..." },
  "prompts": { "..." },
  "logging": { "..." }
}
```

## config.json

実行時の上書き設定。変更頻度: 中。

```json
{
  "version": "1.0.0",
  "overrides": {
    "permissionMode": "plan",
    "allowedTools": ["Read", "Glob", "Grep"]
  },
  "logging": {
    "maxFiles": 50,
    "verbose": true
  }
}
```

## CLI 引数

最優先の上書き。

```bash
deno task agent:iterator \
  --issue 123 \
  --permission-mode plan \
  --max-iterations 20
```

## マージ規則

```
オブジェクト: 再帰的マージ
配列:         上位で置換
プリミティブ: 上位で上書き
```

## 検証

```
load → parse → merge → validate → 起動 or エラー

検証項目:
- 必須フィールドの存在
- 型の整合性
- completionConfig と completionType の対応
```
