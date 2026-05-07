# Triage Agent — Best Practices

入力 (issue / PR / artifact) を読み、**1 つの分類ラベル / verdict** を emit して route するタイプ。原型 A (Single-Step) に該当。原型の定義は [`archetypes.md`](./archetypes.md)、step record / `structuredGate` の field 定義は [`registry-shape.md`](./registry-shape.md) を参照。

## Rules

| # | Rule |
|---|------|
| T1 | **Goal は分類のみ**。同じ agent で「分類 + 並べ替え」「分類 + 編集」を兼ねない。Role の確定は SKILL.md Phase 3.5 (subdivide した step 列から再導出) で行い、`.agent/CLAUDE.md` の per-agent purpose 文は input 参考に留める。複数役割が必要なら別 agent に split |
| T2 | **Verdict 集合を 3-mirror で固定** する。`outputSchemaRef` の enum、prompt の verdict 列挙、step record の `description` 文を全て同じ集合で揃える (SKILL.md R5 + §3-Mirror Invariant)。enum を変えたら 3 つ全てを diff する。例: workflow.json `labelMapping` の kind subset に閉じる場合、3 mirror が同じ kind 列を語る |
| T3 | **Start condition は label / 入力 1 件**。triage は per-issue dispatch 前提で、未分類のみ受ける。既に分類済 (`kind:*` 持ち) の issue を skip する判定は dispatcher 側 (例: `.agent/triager/script/dispatch.sh`) |
| T4 | **Side effect は 1 回だけ**。label 適用 / comment 投稿は terminal step で 1 回。途中 step で副作用を入れない (重複適用の温床) |
| T5 | **Fallback intent を必ず宣言**。`structuredGate.fallbackIntent` を埋め、AI が verdict を欠落しても deterministic に閉じる |
| T6 | **Description に「役割外動詞」を入れない**。Phase 3.5 の negative list (例: triager は `assign order:N` を **しない**) を step `description` から除外する。`pick smallest unused order:N` 等が混入していたら R1+R5 の二重違反 |

## Step shape (典型 Single-Step)

```
clarify (closure, 1 step)
  ├─ structuredGate.allowedIntents: ["closing", "repeat"]
  ├─ outputSchemaRef → enum で verdict を固定
  └─ handoffFields: ["verdict", "final_summary"]
```

`.agent/clarifier/steps_registry.json` (本リポジトリ) はこの形の最小実装。`maxIterations: 1` + `count:iteration` verdict + 1 step closure。

## Anti-Patterns

- **Verdict drift (3-mirror)**: schema enum / prompt verdict 列挙 / step `description` 文 のいずれかが他 2 つと乖離する → `--validate` の `Cross-references` は schema-vs-prompt の prose 突合せまで降りない。SKILL.md §3-Mirror Invariant の手 diff を Phase 6.5 で実施する
- **Description が input 文 (`.agent/CLAUDE.md` 等) を coppy で残している**: 旧 enum / 役割外動詞が残り、subdivide 後に再導出した role と乖離 → T1+T6 違反。Phase 3.5 で確定した role 文をそのまま description に転記する
- **Multi-intent triage**: 1 issue に複数 `kind:*` を付ける → orchestrator 側の per-issue dispatcher が壊れる (triager は exactly one を要求)
- **Recovery in-agent**: 分類失敗 (need-clearance 等) を同じ agent でリトライさせる → 別 agent (clarifier) を置き、workflow.json の phase 遷移で渡す

## 実例 citation

- `.agent/clarifier/steps_registry.json` — 1-step closure、verdict enum (`ready-to-impl|ready-to-consider|still-blocked`)、`fallbackIntent: "closing"`
- `.agent/triager/agent.json` — `verdict.type: "poll:state"`, `maxIterations: 3`, label apply は boundary hook (gh issue edit) で。`description` は workflow.json#labelMapping の kind subset を語り、prompt / schema enum / description の 3 mirror が揃った状態 (R5 example)

## Validation 補助

triage agent は label を扱うため、`--validate` 実行時の `Labels` チェック (workflow.json で宣言した label が repo に存在するか) が特に重要。reflect missing label は `gh label list` で確認し、`.agent/workflow.json` の `labels` セクションを source of truth として更新する。
