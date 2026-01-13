# アクションシステム

> **廃止予定**: このシステムは `08_structured_outputs.md`
> の「完了条件検証と部分リトライ」に置き換えられます。

## 現状と移行

### 現行 Runner での扱い

**現行 Runner はまだ `actions/` ディレクトリのコードを読み込んでいます**。

```
runner.ts
  ├─ ActionDetector.detect()  ← 現在も動作
  └─ ActionExecutor.execute() ← 現在も動作
```

ただし、**完了判定** は `completionConditions` で行うことを推奨します。
アクション検知は「LLM 出力から情報を抽出する手段」であり、
「タスクが完了したかどうかの判定」とは責務が異なります。

### 移行の考え方

| 用途             | 現状                | 推奨                    |
| ---------------- | ------------------- | ----------------------- |
| 完了判定         | action close 検出   | completionConditions    |
| Issue 操作       | action-item handler | GitHub CLI 直接呼び出し |
| ログ記録         | decision handler    | 継続使用可              |
| 構造化データ抽出 | action 検出         | SDK structured output   |

### 廃止タイムライン

1. **現在**: 警告なしで動作（移行期間）
2. **次リリース**: 起動時に deprecation 警告を出力
3. **2リリース後**: actions 設定でエラー、明示的なフラグで動作

## 概要

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

## completionConditions への移行例

### 従来: action で完了判定

```json
{
  "actions": {
    "enabled": true,
    "types": ["issue-action"],
    "handlers": {
      "issue-action": "builtin:github-issue"
    }
  }
}
```

Runner は `action.type === "issue-action"` かつ `result.action === "close"`
で完了と判定。

### 推奨: completionConditions で完了判定

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

LLM が「完了」を宣言した後、外部状態（git、テスト等）を検証して完了を判定。
