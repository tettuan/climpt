# Blueprint Evaluation: Spec + Schema vs 24 Agents

## 総合スコア

| 評価軸                 | v1 (初回) | v2 (Schema実装後) | 変化                                                       |
| ---------------------- | --------- | ----------------- | ---------------------------------------------------------- |
| **構造**               | 100%      | **100%**          | 維持。全24エージェントが3セクション構造に準拠              |
| **用語**               | 85%       | **85%**           | 維持。11用語が辞書未掲載                                   |
| **ルールカバレッジ**   | 70%       | **90%**           | 改善。52ルール中 FAIL 1件 + 未カバー6パターン              |
| **Schema enforcement** | N/A       | **95%**           | 新規。20/20 negative test CAUGHT。30ルールが Schema で強制 |
| **制約遵守**           | 95%       | **100%**          | 改善。C1-C8 全て遵守                                       |

---

## A. Schema 検証結果

### Negative tests: 20/20 CAUGHT

| テスト | 違反内容                           | Schema メカニズム       |
| ------ | ---------------------------------- | ----------------------- |
| 1      | schemas セクション欠落             | required                |
| 2      | agent.name にスペース              | pattern                 |
| 3      | 無効な verdict.type                | enum                    |
| 4      | 無効な permissionMode              | enum                    |
| 5      | poll:state で maxIterations 欠落   | if/then                 |
| 6      | flow step で structuredGate 欠落   | if/then (c2 != section) |
| 7      | flow step で stepKind 欠落         | if/then (c2 != section) |
| 8      | section step に structuredGate     | if/then + not/anyOf     |
| 9      | 無効な intent 値                   | enum                    |
| 10     | handoff あり handoffFields なし    | if/then + contains      |
| 11     | jump あり targetField なし         | if/then + contains      |
| 12     | entryStep + entryStepMapping 両方  | oneOf + not             |
| 13     | retry で maxAttempts なし          | if/then                 |
| 14     | model: "gpt-4"                     | enum                    |
| 15     | closureAction: "destroy"           | enum                    |
| 16     | parameter.type 欠落                | required                |
| 17     | cli: "issue" (-- なし)             | pattern                 |
| 18     | c3: "MyStep" (非 kebab)            | pattern                 |
| 19     | intentSchemaRef: "external.json#/" | pattern ^#/             |
| 20     | targetMode: "auto"                 | enum                    |

### ルール実施の分類

| 分類                 | ルール数 | 内容                                                      |
| -------------------- | -------- | --------------------------------------------------------- |
| **Schema で強制**    | 30       | pattern, enum, required, type, if/then で構造的に違反不可 |
| **Runtime 検証必要** | 22       | cross-ref (R-A1, R-B1, R-B5, R-D1 等)                     |

## B. 整合性ルール検証 (8 agents x 52 rules)

### FAIL: 1件

| Rule     | Agent              | 問題                                                                                                                                    |
| -------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| **R-B3** | 07-workflow-engine | `initial.recover` が `stepKind: "work"` で `allowedIntents: ["next", "abort"]`。`abort` は STEP_KIND_ALLOWED_INTENTS[work] に含まれない |

**根本原因**: `abort` は Schema の intent enum に含まれるが、どの stepKind の
ALLOWED_INTENTS にも含まれない。Schema 検証は通るが R-B3 で必ず失敗する矛盾。

## C. Spec ドキュメント評価

### 使われているが Spec 未記載の機能 (8件)

| 機能                              | 使用 Agent        | 状態                            |
| --------------------------------- | ----------------- | ------------------------------- |
| `runner.flow.schemas.base`        | 20+ agents        | Schema にあり、Spec 未記載      |
| `runner.boundaries.sandbox`       | 24-sandbox-worker | Schema にあり、Spec 未記載      |
| `runner.execution.finalize`       | 24-sandbox-worker | Schema にあり、Spec 未記載      |
| `runner.actions.handlers`         | 24-sandbox-worker | Schema にあり、Spec 未記載      |
| `step.condition` (entry guard)    | 10, 17, 23        | **Schema にも Spec にも未定義** |
| `step.priority`                   | 10, 17            | R-F20 あり、Spec 記載薄い       |
| `validator.successWhen` 有効値    | 多数              | string だが enum 未定義         |
| `defaultModel` override semantics | 18-multi-model    | 優先順位ルール未定義            |

### Schema vs Spec のギャップ (3件)

| ギャップ                  | 影響                                                    |
| ------------------------- | ------------------------------------------------------- |
| **R-B2 未強制**           | c2=initial + stepKind=closure が Schema を通る          |
| **R-B3 未強制**           | work step に closing intent が Schema を通る            |
| **step.condition 未定義** | R-A5 が参照するフィールドが StepDefinition に存在しない |

## D. 推奨対応

### High: Schema 修正

1. `StepDefinition` に `condition` (string) と `priority` (integer) を追加
2. R-B3 を Schema if/then で stepKind 別に allowedIntents を制約
3. `abort` を intent enum から除外 or STEP_KIND_ALLOWED_INTENTS に追加

### Medium: Spec 修正

4. 01-structure.md に sandbox, finalize, actions.handlers, flow.schemas を追記
5. 04-terminology.md に 11 用語を追加
6. R-C7 新設: `successWhen` enum 制約

### Low: Agent 修正

7. 07-workflow-engine の `abort` intent を除去 (R-B3 違反)

## E. v1 → v2 改善

| 項目                 | v1   | v2                       |
| -------------------- | ---- | ------------------------ |
| FAIL ルール数        | 5件  | **1件**                  |
| MISSING パターン     | 12件 | **6件**                  |
| Schema 存在          | なし | **1242行、20/20 CAUGHT** |
| `runtimeUvVariables` | なし | 導入済み                 |

## F. 結論

> **Schema は構造検証として高品質 (20/20 negative tests)。** **52 ルール中 30 が
> Schema で強制、22 が runtime 検証。** **残る課題は R-B3 の Schema 強制と
> step.condition の定義追加。** **基盤は実用レベルに到達している。**
