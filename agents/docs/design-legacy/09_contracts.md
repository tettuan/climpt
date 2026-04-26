# 契約

境界における約束事。この契約に従う限り、内部実装は自由に変更できる。

## 契約の形式

```
入力:    何を受け取るか
出力:    何を返すか
副作用:  何が変わるか
エラー:  何が失敗するか
```

## 設定の契約

### 読み込み

```
load(path) → AgentDefinition | Error

入力:    存在するディレクトリパス
出力:    パース済みの Agent 定義
副作用:  なし（読み取りのみ）
エラー:  NotFound, ParseError
```

### 検証

```
validate(definition) → ValidationResult

入力:    load() の戻り値
出力:    { valid: boolean, errors: Error[] }
副作用:  なし
保証:    valid=true ⇔ errors=[]
```

## 実行の契約

### 実行

```
run(options) → AgentResult

入力:    { cwd: string, args: Record, plugins?: Plugin[] }
出力:    実行結果
副作用:  ループ実行、LLM 呼び出し、ファイル操作
前提:    定義が有効
保証:    必ず Result を返す（例外で終わらない）
```

## 判定の契約

### 完了判定

```
StepValidator.validate(conditions) → ValidationResult

入力:    完了条件の配列
出力:    { valid: boolean, pattern?: string, params?: Record }
副作用:  コマンド実行（git status, deno task test 等）
保証:    valid=false ⇒ pattern が設定される
```

### 形式検証

```
FormatValidator.validate(summary, format) → FormatValidationResult

入力:    IterationSummary（assistantResponses・structuredOutput 含む）、ResponseFormat（形式指定）
出力:    { valid: boolean, error?: string, extracted?: unknown }
副作用:  なし
```

### VerdictHandler

```
VerdictHandler インターフェース

setCurrentSummary(summary) → void
入力:    IterationSummary（structuredOutput 含む）
出力:    なし
副作用:  内部状態の更新（lastSummary）
用途:    isFinished() 呼び出し前に現在の iteration 情報を渡す

isFinished() → Promise<boolean>
入力:    なし（内部状態を使用）
出力:    完了フラグ
副作用:  外部コマンド実行（git status, gh issue view 等）
保証:    AI 宣言と外部条件の両方を考慮
```

### 責務境界

VerdictHandler に Step 遷移の責務を混ぜると、完了判定と進行制御が
同一コンポーネントに集中し、二重ループの分離原則が崩れる。
責務を明示的に分離することで、VerdictHandler の変更が Flow に波及しない
境界を維持する。

VerdictHandler は Agent 完了の判定のみを担う。Step 間の遷移決定は VerdictHandler
の責務ではない。

```
VerdictHandler の責務:
  ✓ Agent 完了の判定 (isFinished)
  ✓ Completion Loop 用プロンプトの生成 (buildInitialPrompt, buildContinuationPrompt)
  ✓ 完了基準の宣言 (buildVerdictCriteria)
  ✓ 副作用の実行窓口 (onBoundaryHook)

VerdictHandler の責務外:
  ✗ Step 間の遷移決定 (→ FlowOrchestrator / WorkflowRouter)
  ✗ intent の解釈 (→ StepGateInterpreter)
  ✗ transitions テーブルの参照 (→ WorkflowRouter)
```

### StepMachineVerdictHandler と steps_registry.json

**他の VerdictType との根本的な違い**

他の VerdictType は「条件を満たしたら完了」である。

- `count:iteration` — 指定回数まわったら完了
- `detect:keyword` — キーワードが出たら完了
- `poll:state` — 外部リソースが目標状態に達したら完了

これらは **やったかどうか** だけを見る。ステップの成果物が正しいかは問わない。

StepMachine (`detect:graph`) だけが異なる。StepMachine は
**やったことが契約どおりに為されているか** を確認する。steps_registry.json に
宣言されたステップの入力条件（uvVariables・C3L パス）と出力仕様
（outputSchemaRef・handoff 項目）を、実行結果の structured output と突き合わせ、
契約を満たしていなければ同じステップに差し戻す（repeat でやり直させる）。
契約を満たして初めて次のステップへ遷移し、step graph の終端に到達したとき Agent
完了となる。

```
他の VerdictType:
  実行した → 条件チェック（回数/キーワード/外部状態）→ 完了

StepMachine:
  実行した → ステップ契約と突き合わせ → 不一致なら差し戻し
                                        → 一致なら次ステップへ
                                        → 終端到達で完了
```

**Why: registry を直接読む必然性**

Flow ループは steps_registry.json から遷移先の stepId を決めるだけであり、
ステップ固有の C3L パス・uvVariables・outputSchemaRef 等の情報を Completion
ループへ渡さない。そのため StepMachineVerdictHandler 自身が registry
を直接読み、 現在の stepId に対応するプロンプト・schema・handoff
項目を取得したうえで、 返ってきた structured output が契約どおりかを判定する。

```
判定プロセス（StepMachineVerdictHandler）:

① steps_registry.json から現在の stepId の定義を取得
   - C3L パス (prompts 参照)
   - outputSchemaRef (期待する出力構造)
   - uvVariables / handoff 項目 (入力条件)

② LLM の structured output を ① の定義と突き合わせ
   - schema が期待する構造を満たしているか
   - handoff に宣言された項目が出力に含まれるか

③ 一致 → step graph 上の遷移を進める
   不一致 → retryPrompt を生成し同じステップへ差し戻す
   終端到達 → Agent 完了
```

StepMachineVerdictHandler が内部に遷移ロジック (transition, getNextStep) を
持つのは、Completion Loop 内での step context 維持と prompt
生成に必要だからであり、Flow ループの遷移決定を代行するためではない。Flow
ループでの遷移は常に FlowOrchestrator が担う。

**Structured Output 統合**:

```
判定ロジック（IssueVerdictHandler）:

① getStructuredOutputStatus() で AI 宣言を取得
   - status === "completed"
   - next_action.action === "closing"

② 外部条件をチェック
   - GitHub Issue が CLOSED か
   - git working directory が clean か

③ 統合判定
   - AI 宣言 && !外部条件 → false（リトライへ）
   - 外部条件 → true
```

## Phase 遷移の契約

Orchestrator が 1 サイクル内で実行する gh 複合操作 (label add / label remove /
handoff comment / close) の一貫性を定義する契約。適用先の詳細シーケンスと補償
マトリクスは `12_orchestrator.md` の「Phase 遷移 Transaction」セクション参照。

### 不変条件

```
phase 遷移は unit-atomic である

- T3..T6 全成功 ⇒ tracker.record + commit (状態確定)
- いずれか失敗 ⇒ rollback (補償を LIFO 実行) + status="blocked" + next-cycle retry
- 中間状態で観測されない: 「label は付いたが issue は open」「close したが
  label は旧 phase のまま」等の片側成功は発生しない

cycleTracker.record は全 T 成功時のみ起動する
  ⇒ 部分失敗サイクルが次サイクル判定を歪めない
```

### 判断基準: TransactionScope を使うか

```
問い: 「片側成功で issue の観測状態が壊れる操作群か?」

Yes ⇒ TransactionScope に閉じ込める
No  ⇒ 独立した try/catch で best-effort 実行でよい
```

### 使用判断表

| ケース                                            | 判断 | 根拠                                                      |
| ------------------------------------------------- | ---- | --------------------------------------------------------- |
| Phase 遷移 (label add + remove + comment + close) | 必要 | close 失敗で label 宙ぶらり (G2) が発生する               |
| 単発 comment 投稿                                 | 不要 | 失敗しても他の状態を壊さない、単独の try/catch で足りる   |
| 独立な複数 issue の順次操作 (batch)               | 不要 | issue 間に依存なし。issue 単位で個別に scope を作ればよい |
| pure 計算 (computeLabelChanges 等)                | 不要 | 副作用がないため補償対象外                                |

### Compensation の契約

```
record(compensation) → void
  入力: { label, idempotencyKey, run: () => Promise<void> }
  副作用: LIFO スタックへ push
  前提: scope が open 状態
  保証: committed / rolledBack 状態では no-op

commit() → Promise<void>
  副作用: 補償スタックを破棄、状態を committed へ遷移
  保証: 冪等 (再呼び出しは no-op)

rollback(cause) → Promise<CompensationReport>
  副作用: 補償を LIFO で実行。個別失敗は捕捉され report.failed に集約
  保証: throw しない。logger 自身の例外も rollback を止めない
        report.partial = succeeded < attempted

Compensation.run() の責務:
  - 冪等性: 同 idempotencyKey での 2 回実行で副作用が重複しない
    (例: compensation comment は `orchestrator.ts` の compensationMarker
    factory から得た文字列を事前検索して skip。形式・表示は同ファイル
    を唯一の source of truth とする)
  - retry: 必要なら run() 内部で実装する (TransactionScope は関与しない)
```

### VerdictHandler 契約との整合

VerdictHandler は Agent 完了を判定するだけで、外部副作用は onBoundaryHook
を単一の出口として実行する (上述「VerdictHandler の責務外」参照)。Orchestrator
側の Phase 遷移 Transaction は **この Boundary Hook の下流** で動作し、
VerdictHandler が verdict を確定した「後」の gh 複合操作の原子性を保証する。
両者は別レイヤーの契約であり、以下の分担を守る:

```
VerdictHandler:       Agent 完了の判定 (isFinished) まで
Boundary Hook:        closing intent 確認 → Runner プロセスで gh 実行
Phase 遷移 Transaction: Orchestrator サイクル内の gh 複合操作を unit-atomic に統合
```

## 接続の契約

### LLM 問い合わせ

```
query(prompt, options) → QueryResult | Error

入力:    プロンプト文字列、セッションオプション
出力:    LLM 応答
副作用:  API 呼び出し
エラー:  ConnectionError（回復可能）
         RateLimitError（回復可能）
         SessionExpired（新規セッションで継続可能）
```

### プロンプト解決

```
resolve(ref, variables) → string | Error

入力:    C3L 参照、置換変数
出力:    解決済みプロンプト文字列
副作用:  ファイル読み込み
エラー:  NotFound
保証:    空文字は返さない
```

## データの契約

### AgentResult

```typescript
interface AgentResult {
  success: boolean;
  reason: string; // 完了/エラーの理由
  iterations: number; // 実行回数

  // SDK メトリクス（result メッセージから取得、optional）
  totalCostUsd?: number; // 累積コスト（USD）
  numTurns?: number; // SDK ターン数
  durationMs?: number; // 実行時間（ミリ秒）
}

// 不変条件:
// success=true  ⇒ reason は完了理由
// success=false ⇒ reason はエラー内容
// totalCostUsd  ⇒ SDK が返した場合のみ設定
```

### ValidationResult

```typescript
interface ValidationResult {
  valid: boolean;
  pattern?: string; // 失敗パターン名
  params?: Record<string, unknown>; // 抽出パラメータ
}

// 不変条件:
// valid=true  ⇒ pattern は undefined
// valid=false ⇒ pattern は設定される
```

### FormatValidationResult

```typescript
interface FormatValidationResult {
  valid: boolean;
  error?: string; // エラーメッセージ（単一）
  extracted?: unknown; // 抽出されたデータ
}
```

## StepContext / InputSpec（データ契約）

Flow ループが渡すハンドオフを単なる Map ではなく契約として固定する。実装は
`agents/loop/step-context.ts` の `StepContextImpl` で提供され、AI 複雑性の増大を
防ぐために「宣言されたものだけが次工程へ進む」という秩序を保証する。

### StepContext

```typescript
interface StepContext {
  outputs: Map<string, Record<string, unknown>>;
  set(stepId: string, data: Record<string, unknown>): void;
  get(stepId: string, key: string): unknown | undefined;
  toUV(inputs: InputSpec): Record<string, string>;
}
```

- **What**: Step ごとの出力を `uv-<stepId>_<key>`
  にマッピングする単一の共有倉庫。
- **Why**: 暗黙共有を禁止し、Completion Loop
  や監査ログが「どこで生まれた値か」を
  即座にトレースできるようにする（`ai-complexity` のエントロピー対策）。

### InputSpec

```typescript
interface InputSpec {
  [variable: string]: {
    from?: string; // "stepId.key"
    required?: boolean; // デフォルト true
    default?: unknown; // required=false の場合のみ
  };
}
```

- **Resolution rules**:
  - required=true かつ値なし ⇒ Error（Flow が stop し原因を report）
  - required=false かつ値なし ⇒ default を使用
- **Why**: 参照元を `stepId.key` 形式で明示することで、Step Flow 設計図と実装を
  1:1 に保ち、手当たり次第の変数参照による複雑化を避ける。

> **注意**: Step InputSpec の `required` はデフォルト `true`。Agent
> ParameterDefinition の `required` はデフォルト `false`。

## エラーの契約

### 分類

```
AgentError（基底）
├── ConfigurationError（回復不能）
│     設定が不正。起動しない。
│
├── ExecutionError（状況による）
│     実行中のエラー。リトライで回復可能な場合あり。
│
└── ConnectionError（回復可能）
      外部接続のエラー。リトライ/フォールバック。
```

### 回復

```
回復可能:
  1. リトライ（最大 N 回）
  2. フォールバック（代替リソース）
  3. スキップ（オプション機能のみ）

回復不能:
  1. 即座に停止
  2. Result.reason に記録
  3. 呼び出し元に伝播
```

## 外部連携の契約

### 派生元ブランチ解決

```
優先順位:
1. コマンドライン引数 --origin
2. Issue のカスタムフィールド
3. Project のカスタムフィールド
4. 設定ファイル

すべて未設定 ⇒ エラー（暗黙のデフォルトなし）
```

### Issue-Branch-Worktree-Instance

```
1:1:1:1 対応

Issue #N
  └── branch: feature/issue-N
        └── worktree: .worktrees/issue-N/
              └── instance: agent-N-{timestamp}

違反:
- 同一ブランチで複数 Agent ⇒ 起動エラー
```

worktree 機能は CLI と統合済み。詳細は `02_core_architecture.md` を参照。

## 互換性の契約

### バージョン

```
{ "version": "1.0", ... }

メジャー変更 ⇒ 後方互換なし
マイナー変更 ⇒ 後方互換
未指定       ⇒ "1.0" として扱う
```

### 非推奨化

```
1. 警告出力（1 マイナーバージョン）
2. エラーに変更（次メジャーバージョン）
3. 削除（その次のメジャーバージョン）
```
