# コアアーキテクチャ

## 意図と原則

Agent は「設定で形を決め、単純なループで動き、完了サブループで終わらせる」
だけの存在に留める。`docs/internal/ai-complexity-philosophy.md`
が述べるように、秩序は放置すると崩れる。二重ループ構成は以下の問いに答える。

- **What**: Agent が繰り返す行為と、その終わり方
- **Why**: ループを分けることで、進行と完了の意図を干渉させない
- **How (最小限)**: ループは Step 定義と C3L プロンプト解決だけで制御する

## Step 完了と Agent 完了

Agent の実行には二つの「完了」が存在する。これらは異なる階層に属し、
異なる責務が判定する。この区別を明示するのは、両者を混同すると 「Step
が終わった＝Agent が終わった」と誤読され、Completion Loop を 経由せず Agent
を終了させる実装が生まれるためである。

```
Agent 完了
│  Completion Loop が検証し、成功を返したとき
│
└── Step 完了 (複数回発生する)
      Flow が intent routing で次の Step へ遷移したとき
```

- **Step 完了**: 1 つの Step の作業が終わり、次の Step へ遷移すること。 Flow
  ループの責務であり、intent（next / repeat / jump / handoff）で制御する。 Step
  完了は Agent の状態を前進させるが、Agent を終了させない。
- **Agent 完了**: Agent 全体の仕事が終わること。Completion Loop の責務であり、
  外部検証（completionConditions）の結果だけが判定権を持つ。

closing intent は「最後の Step が完了した」ことを示す Step 完了の特殊形であり、
Completion Loop の起動トリガーである。closing intent 自体は Agent 完了ではない。

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
  - Step 開始時に JSON Schema を解決し、`formatted: { type: "json_schema" }` で
    Claude SDK に渡す。Schema が無ければ iteration を止め、2 連続失敗で run
    全体を終了する。
  - `handoff` は `stepId.key → uv-stepId_key` の名前空間で蓄積し、Runner が次
    ステップの prompt variables として注入する。
  - ループは状態を巻き戻さない。Step は「完了」を宣言せず、完了判断は Completion
    Loop へ委譲する。
  - `stepKind`（work / verification /
    closure）に応じて許可するツールを切り替え、 Closure 以外の Step から
    Issue/PR 操作が到達しないようにする。

## Completion Loop

- **What**: Flow ループから `completionSignal`（structured output 上の
  `next_action.action: "closing"`）を受け取ったときにだけ
  起動し、完了判定・最終処理・未完了時の指示を担う。
- **Why**: 収束を担保するための専用ループを用意し、完了判定を手続き的に
  積み重ねる。メインループに検証や後片付けを混ぜると、重力原理に反して責務が
  分散する。
- **How (最小限)**:
  - Completion Loop も C3L の `steps/closure/*` プロンプトで制御する。
    ユーザーは docs/ に沿って同一の体系で編集できる。
  - 失敗しても Flow ループは停止せず、Completion Loop が返した `retryPrompt`
    を次イテレーションのプロンプトとして使うだけである。
  - Closure Step から `closing` intent を受け取ったときだけ boundary hook を
    呼び出し、Issue close / release publish 等の副作用はここに限定する。

### Completion Signal の定義

`status: "completed"` と `next_action.action: "closing"` が両方存在するため、
どちらが Completion Loop のトリガーかを厳密に定めないと、Flow
が誤ったタイミングで Agent を完了させる原因となる。以下はその唯一の定義である。

completionSignal とは、Closure Step が structured output で返す
`next_action.action: "closing"` のことである。これ以外の値は completionSignal
ではない。

- `status: "completed"` → completionSignal **ではない**。Flow の参考情報。
- `next_action.action: "next"` → Step 遷移の指示。Flow が処理する。
- `next_action.action: "closing"` → **唯一の completionSignal**。 Completion
  Loop を起動するトリガーとなる。

completionSignal を受け取った Flow は、即座に Agent を完了させるのではなく、
Completion Loop に制御を渡す。Agent 完了の判定権は Completion Loop にのみある。

### Completion Loop の三段構成

AI の自己申告（Closure Prompt）だけでは完了を信頼できず、外部検証（Validation）
を挟まないと false positive が生じる。一方で検証結果をそのまま Flow に返すと
判定ロジックが Flow に漏れる。三段に分けることで、各段の責務を単一にし、 Flow
には最終判定（Verdict）だけを渡す構造を保つ。

Completion Loop は以下の三段で構成される。while ではなく、単発の手続きである。

```
Stage 1: Closure Prompt
  closurePrompt = resolve(c3l.closure, response, handoff)
  closureResult = queryLLM(closurePrompt)
  → Closure Step の AI に最終確認を促し、証跡を構造化する

Stage 2: Validation
  validation = runCompletionConditions(closureResult)
  → completionConditions（外部コマンド）で成果物を機械的に検証する

Stage 3: Verdict
  if validation.allPassed: return { done: true }
  else: return { done: false, retryPrompt: buildRetry(validation) }
  → 検証結果に基づき、Agent 完了 or retryPrompt を Flow へ返す
```

Flow ループは Stage 3 の戻り値だけを受け取る。 done = true なら Agent
を終了し、done = false なら retryPrompt を 次の iteration
のプロンプトとして注入する。

Completion Loop が Agent 完了の唯一の判定者であり、 Flow ループが直接 Agent
を完了させることはない。

## CompletionType と二重ループ

完了の判定基準は Agent の用途によって異なる（Issue 完了、反復回数、外部状態
等）。 しかし Flow ループの進行ロジックは共通である。Strategy
パターンで判定ロジックだけを 差し替えることで、Flow
ループに条件分岐を持ち込まずに多様な完了基準を実現する。

CompletionHandler は Completion Loop の判定ロジックを差し替える Strategy
である。 Flow ループの動作は CompletionType に依存しない。

| CompletionType   | Flow ループ      | Completion Loop の判定基準             |
| ---------------- | ---------------- | -------------------------------------- |
| stepMachine      | Step Flow (必須) | Step 状態機械が終端到達                |
| externalState    | Step Flow (推奨) | 外部リソースが目標状態に到達           |
| iterationBudget  | Step Flow (任意) | N 回の iteration を消化                |
| keywordSignal    | Step Flow (任意) | LLM 出力に特定キーワードを検出         |
| structuredSignal | Step Flow (任意) | LLM 出力に特定 JSON 構造を検出         |
| checkBudget      | Step Flow (任意) | N 回のステータスチェックを消化         |
| composite        | Step Flow (任意) | 上記を AND/OR/FIRST で組み合わせ       |
| custom           | Step Flow (任意) | 外部ファイルから動的ロードしたハンドラ |

- **Flow ループ列**: Step Flow の利用要否。stepMachine は structuredGate
  が必須。 他のタイプは Step Flow なしでも動作可能だが、利用を推奨する。
- **Completion Loop 列**: CompletionHandler.isComplete() が何を見て判定するか。
- **共通**: どの CompletionType でも、Flow が Agent
  完了を直接判定することはない。 Flow は Step 遷移だけを担い、Agent 完了は
  CompletionHandler に委譲する。

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
| Flow ループ       | 実装済 | AgentRunner + WorkflowRouter で単方向遷移を管理。              |
| Completion ループ | 実装済 | CompletionChain で Structured Output + 検証条件を統合。        |
| handoff           | 実装済 | StepContext で Step 間データ引き継ぎを実現。                   |
| Worktree finalize | 実装済 | finalizeWorktreeBranch で merge → push → PR → cleanup を一貫。 |

二重ループ以外の仕組みは、この構造を補助する「周辺惑星」にすぎない。まずコアを
磨き、余計な層を積み上げないこと。それが機能美につながる。
