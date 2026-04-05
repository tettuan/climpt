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
  "name": "session-agent",
  "displayName": "Session Agent",
  "description": "Session management agent",
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
      "config": { "verdictKeyword": "SESSION_COMPLETE" }
    },
    "boundaries": {
      "allowedTools": ["Read", "Write", "Edit", "Bash"],
      "permissionMode": "acceptEdits"
    },
    "logging": {
      "directory": "tmp/logs/agents/session-agent",
      "format": "jsonl"
    }
  }
}
```

## config.json

実行時の上書き設定。変更頻度: 中。

```json
{
  "version": "1.0.0",
  "overrides": {
    "runner.boundaries.permissionMode": "plan",
    "runner.boundaries.allowedTools": ["Read", "Glob", "Grep"]
  },
  "runner": {
    "logging": {
      "maxFiles": 50
    }
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
- runner.verdict.config と runner.verdict.type の対応
```

---

## Breakdown Config (`*-steps-user.yml`)

Agent の C3L プロンプト解決は `@tettuan/breakdown` ライブラリを使用する。 各
Agent に対応する Breakdown 設定ファイルが `.agent/climpt/config/` に必要。

### ファイル構成

```
.agent/climpt/config/
├── {agent}-steps-app.yml    # パス設定 (working_dir, base_dir)
└── {agent}-steps-user.yml   # パラメータ検証 (directiveType, layerType)
```

### directiveType（必須 phase）

`directiveType.pattern` は `steps_registry.json` で使用する c2 値を列挙する。

Runner は以下の phase
にハードコード依存している（`agents/shared/step-phases.ts`）:

| Phase          | 用途          | Runner 依存                                                                       |
| -------------- | ------------- | --------------------------------------------------------------------------------- |
| `initial`      | 初回 step     | `entryStepMapping` で参照                                                         |
| `continuation` | 継続 step     | `workflow-router.ts` がデフォルト遷移で `initial.*` → `continuation.*` に自動変換 |
| `closure`      | 完了判定 step | `inferStepKind()` が closure として処理                                           |
| `verification` | 検証 step     | `inferStepKind()` が verification として処理                                      |

**`initial` と `continuation` は runner の default transition に必須。**
`steps_registry.json` で使用する c2
値がこのパターンに含まれていない場合、`PR-C3L-004` エラーとなる。

### layerType

`layerType.pattern` は `steps_registry.json` で使用する c3 値を列挙する。 Agent
ごとに異なる（例: `issue`, `project`, `review` 等）。

### 例

```yaml
# iterator-steps-user.yml
params:
  two:
    directiveType:
      pattern: "^(initial|continuation|closure|section|retry)$"
    layerType:
      pattern: "^(issue|project|iteration|polling)$"
```

### 変更時の注意

`steps_registry.json` に新しい c2/c3 値を追加した場合、対応する
`*-steps-user.yml`
のパターンも更新すること。整合性テスト（`config-consistency_test.ts`）で検証される。

---

## 注意点

| 項目                | 注意                                        |
| ------------------- | ------------------------------------------- |
| `config.local.json` | 必ず `.gitignore` に追加                    |
| CLI 引数            | 常に最優先、他の設定を上書き                |
| 配列のマージ        | 上位で完全に置換される（マージではない）    |
| `overrides`         | agent.json の `runner.*` 配下のみ上書き可能 |

---

## 関連ドキュメント

| ドキュメント                                                     | 内容                                         |
| ---------------------------------------------------------------- | -------------------------------------------- |
| [01_quickstart.md](./01_quickstart.md)                           | ファイル作成手順                             |
| [02_agent_definition.md](./02_agent_definition.md)               | agent.json の詳細                            |
| [03_builder_guide.md](./03_builder_guide.md)                     | 設計思想と連鎖                               |
| [reference/agent.yaml](./reference/agent.yaml)                   | agent.json 全フィールドリファレンス          |
| [reference/steps_registry.yaml](./reference/steps_registry.yaml) | steps_registry.json 全フィールドリファレンス |
