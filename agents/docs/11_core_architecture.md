# コアアーキテクチャ

## 構造

Agent は二つの世界で構成される。

```
┌─────────────────────────────────────────────────────────┐
│ Agent の世界（内側）                                     │
│                                                         │
│   設定 ──→ ループ ──→ 判定                              │
│                                                         │
│   ┌───────────────────────────────────────────────┐   │
│   │ while (!complete) {                            │   │
│   │   prompt = 解決()                              │   │
│   │   response = 問い合わせ()                      │   │
│   │   complete = 判定()                            │   │
│   │ }                                              │   │
│   └───────────────────────────────────────────────┘   │
│                                                         │
└─────────────────────────────────────────────────────────┘
                          │
                          │ 境界（接続層）
                          ▼
┌─────────────────────────────────────────────────────────┐
│ 外の世界                                                 │
│                                                         │
│   LLM API / ファイル / 外部サービス                      │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## 三つのフェーズ

### 1. 設定フェーズ

**いつ**: Agent 起動時、一度だけ **何を**: すべての構成を読み込み、検証する

```
入力                      出力
────                      ────
agent.json         →      AgentDefinition
steps_registry.json →     StepsRegistry
prompts/           →      PromptSet
```

**契約**:

- 設定は実行前に完結する
- 不正な設定は起動しない
- 実行中に設定は変わらない

### 2. 実行フェーズ

**いつ**: ループ中、繰り返し **何を**: プロンプト解決、LLM
問い合わせ、ステップ遷移

```
1 イテレーション
────────────────
① プロンプト解決 → ② LLM 問い合わせ → ③ 応答処理 → ④ 遷移判定
```

**契約**:

- 状態は一方向に進む（戻らない）
- 各イテレーションは独立している
- 引き継ぎは明示的に宣言する

### 3. 判定フェーズ

**いつ**: 各イテレーション終了時 **何を**: 完了条件の評価、次ステップの決定

```
判定の種類
──────────
完了判定: Agent 全体を終了するか
遷移判定: 次にどのステップへ進むか
```

**Structured Output 統合**:

判定フェーズは AI の宣言（structured output）と外部検証の両方を使用する。

```
判定フロー
──────────
① summary.structuredOutput から AI 宣言を取得
   - status: "completed" / "in_progress" / etc.
   - next_action: { action: "complete" / "continue", reason: "..." }

② 外部条件を検証（git status, GitHub API 等）

③ 統合判定
   - AI 宣言と外部条件の両方が完了 → 完了
   - AI が完了宣言だが外部条件未達 → リトライ（乖離を検出）
   - 外部条件のみ達成 → 完了（structured output 未使用時）
```

この設計により無限ループを防止：AI の宣言が次 iteration に伝達され、
乖離が発生した場合に AI 自身が認識・修正できる。

**契約**:

- 判定は副作用を持たない
- 結果は実行層に返す
- 実行層が状態を更新する

## 依存の方向

```
設定
 │
 ▼
実行 ←── 判定
 │
 ▼
接続（外の世界）
```

**規則**:

- 上から下へ依存する
- 下から上へ依存しない
- 横方向の依存は限定的

## 状態管理

### 状態の所在

```
設定フェーズ: 構成データ（不変）
実行フェーズ: ループ状態、ステップ出力（可変）
判定フェーズ: 完了フラグ、遷移先（一時的）
接続層:       セッション ID（外部管理）
```

### ステップ間のデータ引き継ぎ

> **現状**: この機能は設計段階です。現行 Runner は単一ステップで動作しており、
> ステップ間のデータ引き継ぎは実装されていません。 将来の Step Flow
> 機能で実装予定です。

```
Step A             Step B             Step C
  │                  │                  │
  ▼                  ▼                  ▼
[LLM]              [LLM]              [LLM]
  │                  │                  │
  ▼                  ▼                  ▼
[抽出]             [抽出]             [抽出]
  │                  │                  │
  └───────┬──────────┴──────────┬───────┘
          ▼                     ▼
      StepContext（ステップ出力の蓄積）
          │
          ▼
      UV 変数として次ステップへ注入
```

**名前空間規則**:

```
stepId.key → uv-{stepId}_{key}

例:
measure.height → uv-measure_height
fabric.price   → uv-fabric_price
```

## エラーの分類

```
回復可能（リトライ/フォールバック）
├── 接続タイムアウト
├── レート制限
└── 一時的な外部エラー

回復不能（停止）
├── 設定エラー
├── スキーマ違反
└── ハード上限超過
```

## 複数 Agent

Agent 自体は単一ループ。並列化は外部オーケストレーターが行う。

```
┌───────────────────────────────────────────┐
│ 外部オーケストレーター                     │
│                                           │
│ 1. タスク一覧取得                          │
│ 2. 各タスクに Agent 起動                   │
│ 3. 完了待機                               │
│ 4. 結果集約                               │
└─────────────┬─────────────────────────────┘
              │
    ┌─────────┼─────────┐
    ▼         ▼         ▼
[Agent A] [Agent B] [Agent C]
```

### 1:1:1:1 マッピング

```
1 Issue = 1 Branch = 1 Worktree = 1 Agent Instance
```

同じブランチで複数 Agent は動かない。

worktree 機能は `agents/common/worktree.ts` に実装され、`run-agent.ts`
と統合済み。

**実装済み**:

- `setupWorktree()`: worktree の作成とセットアップ
- `createWorktree()`: 新規 worktree 作成
- `removeWorktree()`: worktree 削除
- `cleanupWorktree()`: クリーンアップ
- `getCurrentBranch()`, `getRepoRoot()`, `generateBranchName()`

**CLI 統合**:

Agent 定義で `worktree.enabled = true` の場合、`run-agent.ts` は自動的に
worktree を作成する。 `--branch` が未指定の場合、ブランチ名は自動生成される（例:
`feature/docs-20260105-143022`）。

```typescript
// run-agent.ts の実装
const worktreeConfig = definition.worktree;
if (worktreeConfig?.enabled) {
  const worktreeResult = await setupWorktree(setupConfig, {
    branch: args.branch, // 省略可（自動生成）
    baseBranch: args.baseBranch, // 省略可（現在のブランチ）
  });
  workingDir = worktreeResult.worktreePath;
}

// 成功時は worktree を削除
if (result.success && worktreeResult) {
  await cleanupWorktree(worktreeResult.worktreePath);
}
```

**ライフサイクル制限（現状）**:

| 操作           | 実装状況 | 備考                           |
| -------------- | -------- | ------------------------------ |
| worktree 作成  | ✓        | setupWorktree() でローカル作成 |
| ローカルマージ | ✓        | 成功時に base branch へマージ  |
| worktree 削除  | △        | 成功時のみ実行、失敗時は残存   |
| リモート push  | -        | 未実装（手動でのpushが必要）   |
| PR 作成        | -        | 未実装（手動でのPR作成が必要） |

> **注意**: 現在の実装は **ローカルのみ** のライフサイクル管理。リモートへの
> push や PR 作成は Agent
> が完了後、手動で行う必要がある。`result.success = false` の場合、 worktree
> とブランチは残存するため、手動でのクリーンアップが必要になる場合がある。

## 実装状況

| 機能             | 設計 | 実装 | 統合 | 備考                              |
| ---------------- | ---- | ---- | ---- | --------------------------------- |
| 設定読み込み     | ✓    | ✓    | ✓    | 動作確認済み                      |
| 実行ループ       | ✓    | ✓    | ✓    | 動作確認済み                      |
| 完了条件検証     | ✓    | ✓    | ✓    | 動作確認済み                      |
| 形式検証         | ✓    | △    | △    | responseFormat 未設定のため未実行 |
| リトライハンドラ | ✓    | ✓    | ✓    | 動作確認済み                      |
| Worktree         | ✓    | ✓    | △    | ローカルのみ、push/PR は未実装    |
| StepContext      | ✓    | -    | -    | Step Flow 機能として将来実装      |
| 複数ステップ遷移 | ✓    | -    | -    | Step Flow 機能として将来実装      |
