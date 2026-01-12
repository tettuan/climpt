# アクションシステム

> **廃止予定**: このシステムは `08_structured_outputs.md`
> の「完了条件検証と部分リトライ」に置き換えられます。 Action
> 検知は手段に過ぎず、本質は「完了条件の検証」と「パターンベースの部分リトライ」です。

LLM 出力から構造化データを検出し、自動処理する。

## 契約

### 検出

```
detect(content) → DetectedAction[]

入力:    LLM 出力テキスト
出力:    検出されたアクション配列
副作用:  なし
```

### 実行

```
execute(actions) → ActionResult[]

入力:    検出されたアクション
出力:    実行結果
副作用:  外部操作（Issue 作成、ファイル書き込み等）
```

## 設定

agent.json で有効化。

```json
{
  "actions": {
    "enabled": true,
    "types": ["decision", "action-item", "note"],
    "outputFormat": "agent-action",
    "handlers": {
      "decision": "builtin:log",
      "action-item": "builtin:github-issue"
    }
  }
}
```

## 出力形式

LLM はアクションを Markdown コードブロックで出力。

````markdown
決定事項:

```agent-action
{
  "type": "decision",
  "content": "TypeScript を採用する",
  "rationale": "型安全性と IDE サポート"
}
```
````

## アクションタイプ

| タイプ        | 用途           |
| ------------- | -------------- |
| `decision`    | 決定事項       |
| `action-item` | タスク         |
| `note`        | メモ           |
| `question`    | 質問（未解決） |
| `summary`     | 要約           |

## ビルトインハンドラ

| ハンドラ                 | 動作                 |
| ------------------------ | -------------------- |
| `builtin:log`            | ログに記録           |
| `builtin:github-issue`   | GitHub Issue 作成    |
| `builtin:github-comment` | Issue にコメント追加 |
| `builtin:file`           | ファイルに書き込み   |

## フロー

```
1. LLM 出力を受信
2. outputFormat のコードブロックを検索
3. JSON をパース
4. types に含まれるタイプか確認
5. 対応するハンドラを実行
6. 結果を返す
```

## データ構造

### DetectedAction

```typescript
interface DetectedAction {
  type: string;
  content: string;
  metadata: Record<string, unknown>;
}
```

### ActionResult

```typescript
interface ActionResult {
  action: DetectedAction;
  success: boolean;
  result?: unknown;
  error?: string;
}
```
