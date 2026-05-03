# Agent Archetypes — Taxonomy

新規 agent を設計するときは「ゼロから組む」のではなく、3 原型のどれに最も近いかを選び、その差分を埋める。本 skill 全体で本 file の archetype 名を共通語彙として使う。

## 3 原型 比較表

| 原型 | Step 数 | VerdictType | Validator / failurePattern | 典型 `.agent/` 実例 | 適合する状況 |
|------|--------:|-------------|----------------------------|----------------------|--------------|
| A. Single-Step | 1 | `count:iteration` | なし | `triager`, `merger`, `clarifier` | 1 ループで完結する transformer。状態機械が不要 |
| B. Multi-Step Linear | 2–N | `count:iteration` | なし (`structuredGate` のみ) | `considerer`, `detailer` | step が直列。gate の intent で遷移するが分岐しない |
| C. Branching + Validator | N+ | `poll:state` 等 | あり (`failurePattern` で recovery) | `iterator`, `reviewer` | 外部状態に応じて分岐し、失敗時に adaptation で復旧 |

「分岐」は `structuredGate.transitions` が複数 target を持つか、`validationSteps` で条件付き回復が定義されているかを意味する。

## 原型 A — Single-Step

**特徴**: 1 iteration で一連の処理を完結する。AI 応答は intent 分岐せず `closing` 一方向。

**Step shape**:
```
clarify (closure, 1 step)
  ├─ structuredGate.allowedIntents: ["closing"]
  ├─ outputSchemaRef → enum で verdict を固定
  └─ handoffFields: ["verdict", "final_summary"]
```

**prompt 配置**: `prompts/steps/closure/<c3>/f_default.md` の 1 ファイル。

**選ぶとき**: 「入力 1 つ → 処理 → ラベル / コメント / close」の単発変換。完了条件が外部状態ではなく「1 回実行したか」で十分なケース。

**`.agent/` 実例**: `.agent/triager/` (label apply), `.agent/clarifier/` (5-gate rubric → re-queue), `.agent/merger/` (PR merge).

## 原型 B — Multi-Step Linear

**特徴**: step は複数あるが遷移は線形。`structuredGate` の intent は `closing` / `repeat` の 2 択で、分岐 branch を持たない。step 間で handoff を通す。

**Step shape**:
```
doc-scan (work) → doc-verify (work) → doc-evidence (work) → consider (closure)
   handoff: doc_paths_required → doc_diff_results → doc_evidence → closing|repeat
```

**prompt 配置**: step ごとに 1 edition (`f_default.md`)。`repeat` 時は同じ step を再実行するため prompt 追加は不要。

**選ぶとき**: step 間で handoff を通すが、外部状態に応じた分岐は要らない。AI が「もう一度考える」と判断したら同じ step に戻れば十分なケース。

**`.agent/` 実例**: `.agent/considerer/` (4-step doc-scan→verify→evidence→consider), `.agent/detailer/` (spec 詳細化).

## 原型 C — Branching + Validator

**特徴**: 外部コマンド (`git status`, `gh pr view`, tests) で状態を検証し、失敗 `failurePattern` を adaptation に写像して recovery prompt を呼び出す。

**Step shape**:
```
plan (work) → impl (work) → verify-impl (work, validator) → closure
                                  │
                                  ├─ git-dirty       → adaptation: git-dirty
                                  ├─ branch-not-pushed → adaptation: branch-not-pushed
                                  └─ tests-failing   → adaptation: tests-failing
```

`failurePatterns` は registry に宣言し、各 pattern を `{ edition: "failed", adaptation: "<name>" }` に写像する。adaptation prompt は `prompts/steps/<c2>/<c3>/f_failed_<adaptation>.md` に置く。

**prompt 配置**: step ごとに `f_default.md` + failure 別の `f_failed_<adaptation>.md`。

**選ぶとき**: 成果物 (branch / PR / 成果ファイル) の妥当性を機械的に検証したい。検証が失敗した瞬間に、失敗理由に応じた recovery prompt を LLM に渡し直したい。

**`.agent/` 実例**: `.agent/iterator/` (`maxIterations: 500`, worktree 有効), `.agent/reviewer/` (`maxIterations: 300`, full review cycle).

## 判定フロー

1 iteration で終わるなら原型 A。終わらず分岐不要なら原型 B。分岐するなら外部状態検証の有無で原型 C と原型 B (transitions 多方向化) を分ける。判定後、対応 reference を開く: A → `triage.md`, B → `architecture-design.md`, C → `implement.md`。
