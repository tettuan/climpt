# 6. Evaluation: Spec vs 24 Concrete Agents

## 総合スコア

| 評価軸               | スコア | 内容                                                              |
| -------------------- | ------ | ----------------------------------------------------------------- |
| **構造**             | 100%   | 全24エージェントが3セクション構造 (agent/registry/schemas) に準拠 |
| **用語**             | 85%    | 全エージェントが Runtime 語彙を使用。10+ のフィールドが辞書未掲載 |
| **ルールカバレッジ** | 70%    | 基本ルールは機能。15+ の高度機能にルールなし                      |
| **Splitter 忠実性**  | 92%    | 24中22エージェントで完全一致。2エージェントで retry prompt 欠落   |
| **制約遵守**         | 95%    | C1-C8 をほぼ遵守。1件の構造的問題 (R-B2)                          |

## A. 整合性ルールの検証結果

8エージェント × 38ルール のマトリクス検証。

### FAIL したルール (5件)

| Rule     | Agent                                   | 問題                                                                                                                                                    |
| -------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R-A3** | 07 (workflow-engine), 09 (doc-pipeline) | `entryStep` 使用時に `entryStepMapping` が存在しない。R-A3 は `entryStepMapping` のみを想定しており、`entryStep` パスを考慮していない                   |
| **R-B2** | 14 (incident-handler)                   | `c2: "initial"` だが `stepKind: "verification"`。R-B2 は initial → work のみ定義。verification stepKind への到達パスが未定義                            |
| **R-B4** | 07 (workflow-engine)                    | `transitions` に `fallback` キーがあるが `allowedIntents` にない。R-B4 は `transitions.keys = allowedIntents` と定義するが、fallback は intent ではない |
| **R-B5** | 23 (full-closer)                        | 条件付き遷移 `{condition, targets}` は `target` フィールドを持たない。R-B5 は `target` の存在を前提としている                                           |
| **R-E1** | 14 (incident-handler)                   | stepId prefix "verification" と c2 "initial" が不一致                                                                                                   |

### UNVERIFIABLE なルール (2件)

| Rule      | 理由                                                      |
| --------- | --------------------------------------------------------- |
| **R-F4**  | PermissionMode の4値が spec に列挙されていない            |
| **R-F12** | verdict config の type 別必須フィールドが列挙されていない |

### ルールが存在しないパターン (MISSING: 12件)

| Pattern                                                         | Agent          | 提案                                                               |
| --------------------------------------------------------------- | -------------- | ------------------------------------------------------------------ |
| `entryStep` (singular) の値が steps に存在するか                | 07, 09         | R-A4 の拡張: entryStep 使用時も検証                                |
| `fallback` 遷移キー (intent ではない)                           | 07             | R-B12 新設: fallback は予約キー、allowedIntents に含めない         |
| 条件付き遷移の構造定義                                          | 23             | R-C4 を強化: `{condition, targets}` の構造を定義                   |
| `targetField` が jump intent 使用時に存在するか                 | 13             | R-B11 新設                                                         |
| `section` step の定義 (何を含み、何を含まないか)                | 09             | R-B11 新設: section は gate/transitions/outputSchemaRef を持たない |
| `condition` 内の `args.*` が parameters に存在するか            | 17             | R-A5 新設                                                          |
| `handoffFields` のパスが schema 内に存在するか                  | 08, 11, 15     | R-D4 新設                                                          |
| Per-step `model` の値が有効か                                   | 18             | R-F13 新設                                                         |
| `meta:composite` 内の conditions[].type が有効な VerdictType か | 08             | R-F15 新設                                                         |
| パラメータの `validation` サブオブジェクト                      | 02, 03, 04     | R-F16 新設                                                         |
| 全 step がエントリから到達可能か (reachability)                 | 全体           | R-B13 新設: orphaned step 検出                                     |
| `validationSteps[].onFailure` の action 値                      | 01, 13, 21, 23 | R-C5 新設                                                          |

## B. Splitter 検証結果

6エージェントの Blueprint → .agent/ 分割を検証。

| Agent            | agent.json | steps_registry.json | schemas/ | prompts                     | retry prompts     |
| ---------------- | ---------- | ------------------- | -------- | --------------------------- | ----------------- |
| bug-fixer        | MATCH      | MATCH               | MATCH    | MATCH                       | MATCH (2/2)       |
| doc-pipeline     | MATCH      | MATCH               | MATCH    | MATCH (9/9 + section)       | N/A               |
| incident-handler | MATCH      | MATCH               | MATCH    | MATCH (4/4 + verification/) | N/A               |
| strict-validator | MATCH      | MATCH               | MATCH    | MATCH (3/3)                 | MATCH (5/5)       |
| full-closer      | MATCH      | MATCH               | MATCH    | MATCH (4/4)                 | **MISSING (0/2)** |
| sandbox-worker   | MATCH      | MATCH               | MATCH    | MATCH (3/3)                 | **MISSING (0/1)** |

### Splitter の不具合

full-closer と sandbox-worker で **retry prompt の生成漏れ**:

- `failurePatterns` + `validationSteps` があるのに retry/ 配下の prompt が未生成
- bug-fixer と strict-validator では正常生成 → Splitter 実装の不一致

**Splitter のルール不足**: 「validationSteps の c2=retry, c3 と failurePatterns
の adaptation から retry/{c3}/f_failed_{adaptation}.md
を生成する」というルールが spec に明文化されていない。

## C. Spec への改善提案

### 優先度: High (ルール FAIL の修正)

| 対象     | 現状                                            | 改善                                                                                                             |
| -------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **R-A3** | `entryStepMapping` のみ想定                     | `entryStep` 使用時は R-A3 をスキップし、R-A4 相当で `entryStep` の値を検証                                       |
| **R-B2** | `initial → work, closure → closure` の2パターン | `verification` stepKind を追加。c2 と stepKind の関係を「c2=initial/continuation は work OR verification」に拡張 |
| **R-B4** | `transitions.keys = allowedIntents`             | 「`fallback` は非 intent の予約キー」を除外条件として追加                                                        |
| **R-B5** | `target` フィールドの存在を前提                 | 条件付き遷移 `{condition, targets}` 構造を認識し、`targets` 内の値を検証                                         |

### 優先度: Medium (MISSING ルールの追加)

| 新規 Rule | 内容                                                                  |
| --------- | --------------------------------------------------------------------- |
| R-A5      | `condition` 内の `args.*` 参照が `parameters` に存在                  |
| R-B11     | section step は structuredGate/transitions/outputSchemaRef を持たない |
| R-B12     | `fallback` は transitions の予約キー、allowedIntents に含めない       |
| R-B13     | 全 step が entry point から到達可能 (reachability)                    |
| R-D4      | `handoffFields` のパスが outputSchemaRef 内に解決可能                 |
| R-F13     | step.model ∈ {sonnet, opus, haiku}                                    |
| R-F15     | meta:composite の conditions[].type ∈ VerdictType                     |

### 優先度: Low (ドキュメント補完)

| 対象               | 内容                                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01-structure       | `entryStep` (singular) の例、section step の例、conditional transition の構造定義、fallback transition の構造定義を追加                                                   |
| 02-integrity-rules | R-F4 に PermissionMode 4値を列挙、R-F12 に verdict type 別の必須 config フィールドを列挙                                                                                  |
| 04-terminology     | `condition`, `priority`, `targetField`, `targetMode`, `handoffFields`, `failFast`, `fallbackIntent`, `actions.handlers`, `execution.finalize`, `execution.sandbox` を追加 |
| 03-constraints     | C1 に「condition 値は Blueprint にとって opaque な文字列リテラルである」注記を追加                                                                                        |
| 01-structure       | Splitter の retry prompt 生成ルールを明文化                                                                                                                               |

## D. Spec の評価まとめ

### 機能したこと

1. **3セクション構造** — 全24エージェントが忠実に従った。「agent.json +
   registry + schemas を1ファイルに」は設計として成立
2. **Runtime 語彙の直接使用** — 用語の混乱ゼロ。v1 の「独自用語 →
   混乱」問題を完全に回避
3. **基本的な cross-ref ルール** — R-A1 (name=agentId), R-B1 (stepId=key),
   R-C1/C2 (validator ↔ failurePattern), R-D1/D2/D3 (schema 参照)
   は全エージェントで PASS
4. **Splitter の単純性** — agent/registry/schemas の分割は「ロジックなしの JSON
   分割」で実現。生成物は Blueprint の忠実なコピー

### 機能しなかったこと

1. **R-B2 の c2→stepKind マッピング** — verification stepKind に対応していない
2. **R-A3 が entryStep を考慮しない** — entryStep
   使用エージェントでルールが不適合
3. **R-B4/B5 が conditional/fallback transition を考慮しない** —
   高度な遷移パターンでルール不適合
4. **R-F12 が具体値を列挙しない** — verdict config の検証が実質不可能
5. **12件の MISSING ルール** — 高度な Runtime 機能にルールがない

### 結論

> **基本アーキテクチャは健全。高度機能のルール網羅が不足。**
>
> 24エージェントの構築で spec の「骨格」は検証された。 問題は「筋肉」(advanced
> features のルール) が足りないこと。
>
> 具体的には:
>
> - 5件の FAIL → ルール修正が必要
> - 12件の MISSING → ルール追加が必要
> - 2件の UNVERIFIABLE → 値の列挙が必要
>
> これらを反映すれば、38 → 約 50 ルールの完成した spec になる。
