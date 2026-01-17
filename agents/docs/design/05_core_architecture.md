# コアアーキテクチャ

## 意図と原則

Agent は「設定で形を決め、単純なループで動き、完了サブループで終わらせる」
だけの存在に留める。`docs/internal/ai-complexity-philosophy.md`
が述べるように、秩序は放置すると崩れる。二重ループ構成は以下の問いに答える。

- **What**: Agent が繰り返す行為と、その終わり方
- **Why**: ループを分けることで、進行と完了の意図を干渉させない
- **How (最小限)**: ループは Step 定義と C3L プロンプト解決だけで制御する

## 二重ループモデル

```
┌───────────────────────────────────────────────┐
│ Basic Loop (Flow)                              │
│ - Step を順番に実行                            │
│ - C3L/Climpt でプロンプト決定                  │
│ - handoff を次ステップへ引き継ぐ               │
└───────────────┬─────────────────────────────┘
                │ completionSignal
┌───────────────▼─────────────────────────────┐
│ Completion Loop                               │
│ - Structured Output と検証条件を取り込む       │
│ - 追加の C3L プロンプトで完了処理を促す        │
│ - 終了 or 未完了の retryPrompt を返す          │
└───────────────────────────────────────────────┘
```

Flow ループは「前へ進むための重力」、Completion ループは「外に漏れないための
境界」として働き、互いに役割を奪わない。

## Basic Loop (Flow)

- **What**: `steps_registry.json` の `entryStep` から始まり、各 Step が宣言する
  次ステップへ進む。Step は `handoff` オブジェクトに成果と引き継ぎ情報をまとめ、
  次の Step に全てを渡す。
- **Why**: エントロピーを抑えるには、ループ内で「計画 → 実行 → 次へ渡す」以外
  の判断を排除する。Work は常に前進し、分岐ロジックや検証は外に出す。
- **How (最小限)**:
  - 各 Step のプロンプト参照は C3L/Climpt 形式 (`c1/c2/c3 + edition`) に限定し、
    docs/ に保存された意味付けに従う。
  - `handoff` は `stepId.key → uv-stepId_key` の名前空間で蓄積し、Runner が次
    ステップの prompt variables として注入する。
  - ループは状態を巻き戻さない。Step は「完了」を宣言せず、完了判断は Completion
    Loop へ委譲する。

## Completion Loop

- **What**: Flow ループから `completionSignal`（structured output 上の
  `status: "completed"` や
  `next_action.action: "closing"`）を受け取ったときにだけ
  起動し、完了判定・最終処理・未完了時の指示を担う。
- **Why**: 収束を担保するための専用ループを用意し、完了判定を手続き的に
  積み重ねる。メインループに検証や後片付けを混ぜると、重力原理に反して責務が
  分散する。
- **How (最小限)**:
  - Completion Loop も C3L の `steps/closure/*` プロンプトで制御する。
    ユーザーは docs/ に沿って同一の体系で編集できる。
  - Structured Output（JSON Schema で定義）を読み取り、`completionConditions`
    の検証結果、`pendingActions`、`retryPrompt` を Flow ループへ返す。
  - 失敗しても Flow ループは停止せず、Completion Loop が返した `retryPrompt`
    を次イテレーションのプロンプトとして使うだけである。

## データ引き継ぎ（handoff）

```
Step A -> handoff { a.finding }
           │
           ▼
Step B receives uv-s_a.finding
```

- 各 Step は「次のステップが何を知るべきか」を明文化し、handoff に格納する。
- Completion Loop も handoff を参照し、最終報告やエビデンスの提示に使う。
- 暗黙参照は認めない。handoff
  に入っていない情報は次ステップに存在しないとみなす。

## Prompt 制御の一元化

- すべてのプロンプトは C3L/Climpt の参照規則で指定する。
- Runner は design/02_prompt_system.md
  に従い、`prompts/<c1>/<c2>/<c3>/f_<edition>.md` から読み込むだけである。
- これによりユーザーは docs/ のガイドラインだけ追えば Step/Completion 両方の
  プロンプトを差し替えられる。Agent はプロンプトファイルの所在に無知なまま動く。

## 実行タイムライン

1. **定義読込**: agent.json、steps_registry.json、schemas、C3L パスを検証する。
2. **Flow 構築**: entryStep を起点に、Step 配置図を作成。ここで分岐や fallback
   を解析するが、実行時はただ次 Step を追うだけ。
3. **ループ実行**: `prompt = resolve(step)` → `response = query()` → `handoff`
   更新を繰り返す。完了宣言が出ない限り、Flow ループ以外の処理をしない。
4. **Completion 起動**: `completionSignal` が届いた iteration だけ Completion
   Loop を呼び、`allComplete` or `retryPrompt` を受け取る。
5. **終了/継続**: Completion Loop が完了を返せば実行終了。未完了なら Flow
   ループは `retryPrompt` から次の Step 作業を開始する。

## 境界と 1:1 マッピング

```
1 Issue = 1 Branch = 1 Worktree = 1 Agent Instance
```

- Flow ループは単一ワークツリー上の連続作業のみ扱う。
- Completion Loop は「ブランチを clean
  に戻し、クローズ条件を満たしたか」を見る。
- 並列化や複数タスクの配分は外部オーケストレータの責務であり、Agent 内では
  一切扱わない。

## 実装メモ

| 領域              | 状態   | Why                                                            |
| ----------------- | ------ | -------------------------------------------------------------- |
| Flow ループ       | 実装済 | FlowController で単方向遷移を管理。                            |
| Completion ループ | 実装済 | CompletionChain で Structured Output + 検証条件を統合。        |
| handoff           | 実装済 | StepContext で Step 間データ引き継ぎを実現。                   |
| Worktree finalize | 実装済 | finalizeWorktreeBranch で merge → push → PR → cleanup を一貫。 |

二重ループ以外の仕組みは、この構造を補助する「周辺惑星」にすぎない。まずコアを
磨き、余計な層を積み上げないこと。それが機能美につながる。
