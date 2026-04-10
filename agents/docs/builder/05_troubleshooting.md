# Agent 開発トラブルシューティング

Agent 開発時によく遭遇する問題と解決方法。

## 目次

- [構造化出力 (Structured Output)](#構造化出力-structured-output)
  - [outputSchemaRef の形式エラー](#outputschemaref-の形式エラー)
  - [スキーマロードエラー](#スキーマロードエラー)
  - [構造化出力が効かない](#構造化出力が効かない)
- [Boundary Hook / Issue 操作](#boundary-hook--issue-操作)
  - [Issue が意図せず close される](#issue-が意図せず-close-される)
- [サンドボックス / GitHub アクセス](#サンドボックス--github-アクセス)
  - [`gh` コマンドが TLS 証明書エラーまたはネットワークエラーで失敗する](#gh-コマンドが-tls-証明書エラーまたはネットワークエラーで失敗する)
- [エージェントの行動制御](#エージェントの行動制御)
- [ログの読み方](#ログの読み方)

---

## 構造化出力 (Structured Output)

### outputSchemaRef の形式エラー

**症状**

```
Failed to load schema from undefined#undefined
```

**原因**

`outputSchemaRef` を文字列形式で指定している。

```json
// ❌ 間違い: 文字列形式
"outputSchemaRef": "step-output.schema.json"
```

**解決方法**

オブジェクト形式で指定する。

```json
// ✅ 正しい: オブジェクト形式
"outputSchemaRef": {
  "file": "step-output.schema.json",
  "schema": "initial.assess"
}
```

| プロパティ | 説明                                                                    | 例                                                    |
| ---------- | ----------------------------------------------------------------------- | ----------------------------------------------------- |
| `file`     | スキーマファイル名（エージェントの schemas ディレクトリからの相対パス） | `"step-output.schema.json"`                           |
| `schema`   | definitions 内のキー名、または JSON Pointer                             | `"initial.assess"` / `"#/definitions/initial.assess"` |

**関連ドキュメント**

- スキーマ定義: `agents/schemas/steps_registry.schema.json`
- 型定義: `agents/common/validation-types.ts` (OutputSchemaRef interface)

---

### スキーマロードエラー

**症状**

```
Schema file not found: /path/to/.agent/my-agent/schemas/step-output.schema.json
```

または

```
[SchemaPointerError] Cannot resolve pointer "#/definitions/nonexistent" in step-output.schema.json
```

**原因と解決方法**

| エラー種別       | 原因                                | 解決方法                                                |
| ---------------- | ----------------------------------- | ------------------------------------------------------- |
| File not found   | スキーマファイルが存在しない        | `.agent/{agentId}/schemas` ディレクトリにファイルを配置 |
| Pointer error    | `schema` で指定したキーが存在しない | definitions 内のキー名を確認                            |
| JSON parse error | スキーマファイルが不正な JSON       | JSON 構文を検証                                         |

**スキーマファイルの構造例**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "definitions": {
    "initial.assess": {
      "type": "object",
      "required": ["intent", "target"],
      "properties": {
        "intent": { "type": "string", "enum": ["next", "closing", "repeat"] },
        "target": { "type": "string" }
      }
    }
  }
}
```

`"schema": "initial.assess"` は `definitions.initial.assess` を参照します。

---

### 構造化出力が効かない

**症状**

- Agent が JSON 形式で応答しない
- Agent がプロンプトの制約を無視して実装を始める
- `next_action` や `intent` が期待と異なる

**原因**

構造化出力が適用されないと、LLM は自由に応答します。

**確認手順**

1. ログで構造化出力の適用状況を確認

```bash
grep -E "(Loaded and resolved schema|Failed to load schema|No outputSchemaRef)" tmp/logs/*.jsonl
```

2. `outputSchemaRef` が正しく設定されているか確認

```bash
cat .agent/my-agent/steps_registry.json | jq '.steps["initial.assess"].outputSchemaRef'
```

**解決方法**

1. `outputSchemaRef` をオブジェクト形式で設定
2. スキーマファイルが存在することを確認
3. `schema` で指定したキーが definitions に存在することを確認

---

## Boundary Hook / Issue 操作

### Issue が意図せず close される

**症状**

- 中間 Agent（Analyst, Architect, Writer 等）が closure step で Issue を close
  してしまう
- Multi-agent ワークフローで、後続の Agent が処理すべき Issue が見つからない

**原因**

`github.defaultClosureAction` のデフォルト値が `close` のため、closure step で
`closing` intent を返すと Boundary Hook が Issue を自動的に close する。

```
closure step → closing intent → Boundary Hook → Issue close (デフォルト動作)
```

**解決方法**

中間 Agent の `agent.json` で `defaultClosureAction` を `label-only`
に設定する。この設定は 2 つのレイヤーに影響する:

1. **Boundary Hook 層**: `gh issue close` の実行をブロック
2. **Prompt 層**: `buildVerdictCriteria()` が「Do NOT close the issue」を
   生成し、フォールバックプロンプトも `"action":"complete"`（phase
   完了）に切り替わる

```json
{
  "runner": {
    "integrations": {
      "github": {
        "enabled": true,
        "defaultClosureAction": "label-only",
        "labels": {
          "completion": {
            "add": ["planning"],
            "remove": ["backlog"]
          }
        }
      }
    }
  }
}
```

**Multi-agent ワークフローの設定例**

| Agent       | defaultClosureAction | 完了時の動作                      |
| ----------- | -------------------- | --------------------------------- |
| Analyst     | `label-only`         | ラベルを `planning` に変更        |
| Architect   | `label-only`         | ラベルを `ready` に変更           |
| Writer      | `label-only`         | ラベルを `needs-review` に変更    |
| Reviewer    | `label-only`         | ラベルを `reviewed` に変更        |
| Facilitator | `close`              | Issue を close（最終 Agent のみ） |

**関連ドキュメント**

- 設定詳細:
  [02_agent_definition.md - github.defaultClosureAction](02_agent_definition.md#githubdefaultclosureaction)
- 設計背景:
  [../design/04_step_flow_design.md - Section 7.1 Boundary Hook](../design/04_step_flow_design.md)

---

## エージェントの行動制御

### 制御レイヤーの優先度

Agent の行動は以下の 3 層で制御されます（優先度順）：

| 優先度 | 制御レイヤー     | 機能                                  | 効果               |
| ------ | ---------------- | ------------------------------------- | ------------------ |
| 1      | **構造化出力**   | JSON 形式を強制、intent/target を制御 | 最も確実           |
| 2      | **allowedTools** | 使用可能なツールを物理的に制限        | ツールレベルで制限 |
| 3      | **プロンプト**   | 自然言語での指示                      | LLM の解釈に依存   |

**重要**: 構造化出力が効かない場合、2 と 3 だけでは行動を完全に制御できません。

### allowedTools でツールを制限しても効かない

**原因**

構造化出力が効いていない可能性があります。

**解決方法**

1. まず構造化出力が正しく適用されているか確認（上記参照）
2. `allowedTools` の設定を確認

```json
// steps_registry.json
"initial.assess": {
  "allowedTools": ["Read", "Grep", "Glob"],
  "outputSchemaRef": { ... }
}
```

---

## ログの読み方

### ログファイルの場所

```
tmp/logs/{session-id}.jsonl
```

### 重要なログエントリ

| パターン                                       | 意味                                |
| ---------------------------------------------- | ----------------------------------- |
| `Loaded and resolved schema`                   | 構造化出力が正常に適用              |
| `Failed to load schema`                        | スキーマロード失敗                  |
| `No outputSchemaRef for step`                  | ステップに outputSchemaRef が未設定 |
| `[SchemaPointerError]`                         | JSON Pointer 解決失敗               |
| `Schema resolution failed N consecutive times` | 連続失敗でフロー停止                |

### エラー診断コマンド

```bash
# エラーと警告を抽出
grep -E '"level":"(error|warn)"' tmp/logs/*.jsonl | jq -r '.message'

# 特定ステップのログを確認
grep '"stepId":"initial.assess"' tmp/logs/*.jsonl | jq .

# 構造化出力の状態を確認
grep -E "(outputSchemaRef|Loaded.*schema|Failed.*schema)" tmp/logs/*.jsonl
```

---

## サンドボックス / GitHub アクセス

### `gh` コマンドが TLS 証明書エラーまたはネットワークエラーで失敗する

**症状**

```
error connecting to api.github.com: tls: failed to verify certificate
```

または

```
Could not resolve host: api.github.com
```

Agent の Bash ツール内で `gh` や `curl https://api.github.com/...` を実行した
場合に発生する。

**原因**

GitHub ドメインはサンドボックスの `trustedDomains` から **意図的に除外** されて
いる。これは設計上の決定であり、Agent が直接 GitHub にアクセスすることを
決定論的に防止するためのものである。

**解決方法**

| 操作                                         | 方法                                                          |
| -------------------------------------------- | ------------------------------------------------------------- |
| GitHub 読み取り（Issue、PR、ファイル等）     | `mcp__github__github_read` MCP ツールを使用する               |
| GitHub 書き込り（Issue close、ラベル変更等） | Boundary Hook 経由（closure step で `closing` intent を返す） |

**補足**

- システムプロセス（Boundary Hook、worktree ファイナライズ、オーケストレータ）は
  サンドボックス外で `Deno.Command("gh")` を実行するため、この制限の **影響を
  受けない**
- `excludedCommands` を使って `gh`
  をサンドボックスから除外することは推奨しない。 MCP ツールと Boundary Hook
  による制御が正規のアクセスパスである
- 参照: `agents/runner/sandbox-defaults.ts`, `agents/runner/github-read-tool.ts`

---

## permissionMode の設定ミス

### bypassPermissions で Claude Code がクラッシュする

**症状**

```
Claude Code process exited with code 1
```

他の agent（`acceptEdits` を使用）は同じ環境で正常に動作する。

**原因**

`permissionMode: "bypassPermissions"` は Claude Code CLI に
`--dangerously-skip-permissions` フラグを要求する。このフラグなしでは Claude
Code が即座に exit code 1 で終了する。

**解決方法**

対話的な開発では `acceptEdits` を使用する:

```json
{
  "runner": {
    "boundaries": {
      "permissionMode": "acceptEdits"
    }
  }
}
```

**permissionMode の選択基準**

| モード              | 用途                   | 前提条件                              |
| ------------------- | ---------------------- | ------------------------------------- |
| `default`           | 厳格な権限制御         | なし                                  |
| `plan`              | 計画モード             | なし                                  |
| `acceptEdits`       | ファイル編集を自動承認 | なし                                  |
| `bypassPermissions` | 全操作を自動承認       | `--dangerously-skip-permissions` 必須 |

**二次エラーに注意**

この問題が発生すると、以下のエラーが連鎖的に発生する:

```
Claude Code process exited with code 1
  → assistantResponses: []
  → structuredOutput: null
  → [StepFlow] No intent produced for iteration 2 on step "..."
```

`No intent produced` はプロセスクラッシュの結果であり、スキーマや intent 設定の
問題ではない。根本原因（permissionMode）を先に確認すること。

---

## よくある質問

### Q: スキーマロードに失敗した場合、エージェントは停止すべきか？

**A**: 現在の実装では、エラーの種類によって挙動が異なります：

| エラー種別           | 挙動               | 理由                         |
| -------------------- | ------------------ | ---------------------------- |
| `SchemaPointerError` | 2 回連続失敗で停止 | 設定ミスの可能性が高い       |
| ファイル未発見       | 警告を出して続行   | オプショナルな機能として扱う |
| その他のエラー       | 警告を出して続行   | 一時的な問題の可能性         |

### Q: 文字列形式の outputSchemaRef はサポート予定？

**A**: 現時点では予定なし。オブジェクト形式により `file` と `schema`
を明示的に指定でき、デバッグが容易になります。

---

## 関連ドキュメント

- [Agent 作成クイックスタート](01_quickstart.md)
- [Agent 定義リファレンス](02_agent_definition.md)
- [構造化出力設計](../design/05_structured_outputs.md)
- [Step Flow 設計](../design/04_step_flow_design.md)
