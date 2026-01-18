Agent のテストを開始する。
設定とプロンプトで作成可能なので、以下の手順でテストする。

## スキーマ解決失敗時の停止ルール（Fail-Fast）

**重要**: スキーマ解決に失敗した場合、ランナーは以下のルールで動作します：

1. **1回目の失敗**: 警告ログを出力し、`StructuredOutputUnavailable` として
   StepGate をスキップ。同じステップで次のイテレーションを試行。
2. **2回連続の失敗**: `FAILED_SCHEMA_RESOLUTION`
   エラーで即座に停止。無限ループを防止。

### ログメッセージ

- `[SchemaResolution] Failed to resolve schema pointer (failure N/2)` -
  スキーマポインタ解決失敗
- `[SchemaResolution] Marking iteration as StructuredOutputUnavailable` -
  StepGate スキップ
- `FAILED_SCHEMA_RESOLUTION` - 2回連続失敗で停止

### よくある原因と対処

| 原因                                                        | 対処法                                                     |
| ----------------------------------------------------------- | ---------------------------------------------------------- |
| `outputSchemaRef.schema` が bare name (`"initial.default"`) | JSON Pointer 形式に変更: `"#/definitions/initial.default"` |
| `schemas/step_outputs.schema.json` が存在しない             | スキーマファイルを作成                                     |
| ポインタ先の `definitions` が存在しない                     | スキーマファイルに定義を追加                               |

### 参照

- `agents/docs/builder/01_quickstart.md` - スキーマ設定の正しい形式
- `agents/docs/design/08_step_flow_design.md` - Flow ステップの要件

---

テスト方法：ランダムテスト
テスト概要：エージェント名を、以下の「ジャンル」からランダムに選び、選んだジャンルの中から、さらに特定の作業プロセス名称をランダムに決める。これを「エージェント名」とする。
テストの目的：
複数ステップ、ステップの手戻りを伴う、多段階で30近いステップ実行のエージェント構築と実装の容易性を確認する。（最低5step以上、30ステップ以内）

その後、以下の「手順」に従う。

## ジャンル

ランダム値は、新たなbash実行から得ること。

- 家事
- 移動
- 買い物
- 記事作成
- ソフトウェア開発
- 本屋
- 花屋
- 芸能
- スポーツ練習
- 経理
- 広報
- デザイン受託
- その他分野からランダムに選ぶ

## 手順

1. quickガイドをもとにエージェントを構築する（既存実装を参照しない）

   **Skill を使用**: `/agent-scaffolder` を呼び出して雛形を生成する。

   ```
   /agent-scaffolder
   ```

   参照ドキュメント:
   - `agents/docs/builder/01_quickstart.md`
   - `agents/docs/design/08_step_flow_design.md`

- `entryStepMapping` または `entryStep` を**必ず**定義する
- `.agent/{agent}/schemas/*.schema.json` を作成し、すべての Flow/Closure Step に
  `outputSchemaRef` を設定する
- プロンプトには Structured Output (JSON)
  を**強制**する記述を追加し、`next_action.action` を明示させる
- **`closing` intent**: Closure Step (`closure.*`) のみが `closing` を返す。work
  step (`initial.*`, `continuation.*`) は `closing` を返さない 1-1.
  エージェントに応じて、ステップを決め、対応するプロンプトも作ること 1-2.
  ブランチを `test/agent-validation` ブランチに維持すること 1-3.
  ブランチは最終的に破棄するため、コミットは不要

2. 構築したエージェントへ依頼する内容を issue へ書く
3. 実行手順を tmp/tests/{agent-name}/
   配下に階層を作って作成し、ログの書き出される場所も記す 4-1. gh issue
   番号を示した実行CLIを示す（実行はしない） 4-2.
   期待する実行結果を記載する（プロンプトやissueから、予測される結果を導き出す）

---

実行手順に従い、他のプロセス（Terminal）から実行する。これは待機していること。（あなたが実行しない）

---

実行した報告をもとに、あなたはログを監視する。
問題点を把握し、記録する。修正はしない。

---

## 実行CLI

```bash
# Agent 一覧
deno run -A agents/scripts/run-agent.ts --list

# 基本実行
deno run -A agents/scripts/run-agent.ts --agent {agent-name} --issue {number}

# イテレーション制限付き
deno run -A agents/scripts/run-agent.ts --agent {agent-name} --issue {number} --iterate-max 10

# worktree モードでブランチ指定
deno run -A agents/scripts/run-agent.ts --agent {agent-name} --issue {number} \
  --branch feature/test-{number} --base-branch release/x.x.x
```

### オプション一覧

| オプション             | 説明                                   |
| ---------------------- | -------------------------------------- |
| `--agent, -a <name>`   | Agent 名を指定 (必須)                  |
| `--issue, -i <number>` | 対象の GitHub Issue 番号               |
| `--iterate-max <n>`    | 最大イテレーション数 (デフォルト: 100) |
| `--resume`             | 前回セッションを再開                   |
| `--branch <name>`      | worktree 用ブランチ名                  |
| `--base-branch <name>` | worktree のベースブランチ              |
| `--no-merge`           | 完了後の自動マージをスキップ           |
| `--push`               | マージ後にリモートへプッシュ           |
| `--create-pr`          | 直接マージではなく PR を作成           |

## ログの監視

ログは `tmp/logs/agents/{agent-name}/` に出力される。

```bash
# 最新ログファイルを確認
ls -lt tmp/logs/agents/{agent-name}/ | head -5

# リアルタイム監視
tail -f tmp/logs/agents/{agent-name}/{log-file}.jsonl
```

### ログフォーマット (JSONL)

```json
{"timestamp":"...","level":"info","message":"Agent started","data":{...}}
{"timestamp":"...","level":"debug","message":"SDK message: user"}
{"timestamp":"...","level":"debug","message":"Assistant response","data":{"content":"..."}}
{"timestamp":"...","level":"info","message":"[StepFlow] Interpreted intent: closing","data":{...}}
{"timestamp":"...","level":"info","message":"Agent completed after N iteration(s): ..."}
```

### 問題点の記録

- tmp/tests/{agent-name}/troubles/
  配下に階層を作って、都度問題点を記録する。起きたことを書くこと。

問題点の例：

- 示された情報だけではなく、既存実装を調べるような手順を考慮してしまうこと（ドキュメントからの指示が不足）
- `closing` intent を work step で返してしまう（プロンプトの制約不足）
- スキーマ解決失敗でループが停止する（`outputSchemaRef` の設定ミス）

## Intent マッピング

AI の `next_action.action` から遷移を決定:

| AI 応答    | Intent    | 動作                      |
| ---------- | --------- | ------------------------- |
| `next`     | `next`    | 次の Step へ              |
| `continue` | `next`    | 次の Step へ              |
| `repeat`   | `repeat`  | 同じ Step を再実行        |
| `retry`    | `repeat`  | 同じ Step を再実行        |
| `closing`  | `closing` | 完了 (Closure Step のみ)  |
| `done`     | `closing` | 完了                      |
| `finished` | `closing` | 完了                      |
| `complete` | `closing` | 完了 (後方互換エイリアス) |
| `escalate` | `abort`   | 中断                      |
| `abort`    | `abort`   | 中断                      |

詳細: `agents/docs/design/08_step_flow_design.md`

## Step フロー構成

```
.agent/{agent-name}/prompts/steps/
├── initial/        # 初期フェーズ (work step)
│   └── {c3}/
│       └── f_default.md
├── continuation/   # 継続フェーズ (work step)
│   └── {c3}/
│       └── f_default.md
└── closure/        # 完了フェーズ (closure step)
    └── {c3}/
        └── f_default.md
```

### Step の役割

| フェーズ     | Step ID 例             | 返せる Intent            | 役割               |
| ------------ | ---------------------- | ------------------------ | ------------------ |
| initial      | `initial.default`      | `next`, `repeat`, `jump` | タスク分析・計画   |
| continuation | `continuation.default` | `next`, `repeat`, `jump` | 作業実行・継続     |
| closure      | `closure.default`      | `closing`, `repeat`      | 完了確認・締め処理 |

**重要**: work step (`initial.*`, `continuation.*`) は `closing`
を返さない。Closure Step (`closure.*`) のみが `closing` を宣言して Flow
を閉じる。
