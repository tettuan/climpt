# 拡張ポイント

Agent を拡張する方法。Agent 自体を複雑にせず、組み合わせで機能を増やす。

## 拡張の原則

```
✓ 設定で拡張       新しいオプションを追加
✓ 差し替えで拡張   コンポーネントを入れ替え
✓ 組み合わせで拡張 複数 Agent、外部ツール

✗ コア改変         Agent 本体の変更は最終手段
```

## 設定による拡張

### 完了条件の追加

```json
{
  "verdict": {
    "type": "meta:composite",
    "mode": "any",
    "conditions": [
      { "type": "count:iteration", "budget": 10 },
      { "type": "detect:keyword", "keywords": ["DONE"] }
    ]
  }
}
```

### ステップの追加

```json
{
  "steps": {
    "init": {
      "c1": "steps",
      "c2": "init",
      "c3": "prepare",
      "edition": "default",
      "next": "work"
    },
    "work": {
      "c1": "steps",
      "c2": "work",
      "c3": "execute",
      "edition": "default",
      "inputs": { "init.result": true },
      "next": "verify"
    }
  }
}
```

### 入出力の宣言

```json
{
  "measure": {
    "outputs": {
      "height": { "type": "number", "required": true },
      "chest": { "type": "number", "required": true }
    }
  },
  "fabric": {
    "inputs": {
      "measure.height": { "required": true },
      "measure.chest": { "required": true }
    }
  }
}
```

## 差し替えによる拡張

### 設定ソース

```
デフォルト: ファイルから読み込み
差し替え例: 環境変数、API、データベース
```

### LLM プロバイダー

```
デフォルト: Claude Agent SDK
差し替え例: OpenAI、ローカル LLM
```

### プロンプト解決

```
デフォルト: C3L ファイル参照
差し替え例: データベース、API
```

### 出力抽出

```
デフォルト: JSON ブロック抽出
差し替え例: XML、カスタム構文
```

## 組み合わせによる拡張

### 複数 Agent

```
並列: 同一定義を複数起動
      Agent A, Agent B, Agent C が同時実行

直列: 結果を次の入力に
      Agent A → Agent B → Agent C

分岐: 条件で分岐して合流
      A → (B|C) → D
```

### 外部オーケストレーター

```typescript
// 複数 Issue を並列処理
const results = await Promise.all(
  issues.map((issue) =>
    spawnAgent({
      agent: "iterator",
      args: { issueNumber: issue.number },
      worktree: `.worktrees/issue-${issue.number}`,
    })
  ),
);
```

### ライフサイクルフック

```typescript
interface Hooks {
  onStart?(): Promise<void>;
  onIterationEnd?(summary): Promise<void>;
  onStop?(result): Promise<void>;
}

// 例: 完了時に Slack 通知
const hooks = {
  onStop: async (result) => {
    await slack.notify(`完了: ${result.reason}`);
  },
};
```

## OutboxAction 拡張 (v1.14.x)

v1.14.x で Project Orchestration を導入するにあたり、OutboxAction union に 4
種の project 操作が追加された。

| action                      | 用途                                     |
| --------------------------- | ---------------------------------------- |
| `add-to-project`            | Issue を project に追加 (late-bind 対応) |
| `remove-from-project`       | Project item の削除                      |
| `update-project-item-field` | Project item の field 値更新             |
| `close-project`             | Project の close                         |

既存 4 種 (`comment`, `create-issue`, `update-labels`, `close-issue`) は不変。
契約の詳細 (late-binding、DeferredItemsEmitter との連携) は
[§13 Project Orchestration](13_project_orchestration.md) §2.3 を参照。

## IssueCriteria 拡張 (v1.14.x)

`IssueCriteria` に `project?: ProjectRef` field が追加され、project-scoped な
issue dispatch が可能になった。CLI では `--project <owner>/<number>`
で指定する。 未指定時は従来の label/state filter のみで動作する (BC 維持)。

契約の詳細は [§13 Project Orchestration](13_project_orchestration.md) §2.6
を参照。

## 拡張しないもの

以下は Agent の責務外。外部で対応する。

| やりたいこと     | 対応方法               |
| ---------------- | ---------------------- |
| 並列実行         | 複数 Agent 起動        |
| スケジュール実行 | cron、GitHub Actions   |
| 結果集約         | 外部スクリプト         |
| PR 作成・マージ  | 外部オーケストレーター |
| 承認フロー       | GitHub PR レビュー     |
| 通知             | フック + 外部 API      |

## 拡張の注意

### インターフェースを守る

```typescript
// 良い: 定義済みインターフェースを実装
class MyHandler implements VerdictHandler {
  check(context) {}
  isFinished() {}
  getReason() {}
}

// 悪い: 独自メソッドに依存
class MyHandler {
  customCheck() {} // 他から呼べない
}
```

### 依存の方向を守る

```
✓ 拡張 → コア（コアを使う）
✗ コア → 拡張（特定拡張に依存しない）
```

### テスト可能に

```typescript
// 良い: 依存を注入
class MyHandler {
  constructor(private deps: Dependencies) {}
}

// 悪い: 依存をハードコード
class MyHandler {
  private deps = new HardcodedDeps();
}
```

## 設定ファイルの階層

```
.agent/my-agent/
├── agent.json           # 基本設定（コミット）
├── config.json          # プロジェクト固有（gitignore 可）
└── config.local.json    # ローカル開発（gitignore）

マージ優先順位: local > config > agent
```
