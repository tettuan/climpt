# Architecture / Design Agent — Best Practices

issue / 要件を読み、**設計 doc / decision artifact を出す** タイプ。コード実装はせず、`docs/`, `agents/docs/`, design note などを emit する。原型 B (Multi-Step Linear) が中心。原型の定義は [`archetypes.md`](./archetypes.md)、step record / `structuredGate` の field 定義は [`registry-shape.md`](./registry-shape.md) を参照。

## Rules

| # | Rule |
|---|------|
| D1 | **Doc-scan を最初の step に**: 関連 doc path を列挙する step を必ず先頭に置き、後続 step が参照すべき source を handoff で固定する。doc を「探しながら書く」フローを作らない |
| D2 | **Evidence step を verdict より前に**: 設計判断 (verdict) は evidence (commit / diff / 既存 doc 引用) の **後段** で出す。同じ step に詰めると LLM が evidence なしで結論を出す |
| D3 | **`docs-writing` skill 準拠**: 出力 doc は 5-level abstraction framework (`/docs-writing`) に従う。Level 2 (Structure / Contract) を最低限 emit する step を必ず通す |
| D4 | **Option 比較は `option-scoring` に委譲**: 2 案以上の比較を doc に含めるなら、当該 step prompt で `/option-scoring` を呼び、matrix + recommendation を必須出力にする (`.claude/rules/option-scoring.md`) |
| D5 | **Diff 検証 step を partial verification として持つ**: 「doc が実際に更新されたか」を `git diff` ベースで検証する step を flow 末尾に置く。LLM の自己申告に依らない |

## Step shape (典型 Multi-Step Linear)

```
doc-scan (work)        → 必要 doc path を列挙
   ↓ handoff: doc_paths_required
doc-verify (work)      → 各 path に diff があるか検証 (partial verification)
   ↓ handoff: doc_diff_results
doc-evidence (work)    → diff 元の commit / 引用を収集
   ↓ handoff: doc_evidence
consider (closure)     → evidence を踏まえ最終 verdict を emit (closing | repeat)
```

`.agent/considerer/steps_registry.json` がこの形の典型。`doc-scan → doc-verify → doc-evidence → consider` で **fact-gathering と verdict authority を分離** している (verdict は terminal step だけが持つ)。

## Anti-Patterns

- **Verdict step が evidence も兼任**: 同じ step で「証拠集め + 結論」を出す → D2 違反、LLM が hallucinate しても気付かない
- **Doc 更新の自己申告**: 「doc を更新しました」と LLM が宣言して closing → D5 違反。`git diff <baseline>` を `validators` で実行する step が必要
- **Option 列挙のみ doc**: A 案 / B 案を並べて recommendation を書かない → `.claude/rules/option-scoring.md` の skip 条件を満たさない限り違反。`/option-scoring` を呼ぶ
- **Free-form prompt** (構造を指定せず「設計案を書け」とだけ言う): 出力 schema が無いと後続 step が読めない。`outputSchemaRef` を必ず付ける

## 実例 citation

- `.agent/considerer/steps_registry.json` — 4-step linear (`doc-scan → doc-verify → doc-evidence → consider`)、`structuredGate.handoffFields` で fact を順送り、verdict は terminal step のみ
- `.agent/considerer/agent.json` — `verdict.type: "count:iteration"`, `maxIterations: 1`, structuredGate のみで分岐なし (Linear archetype 的)
- `.agent/detailer/` — design subset。spec を詳細化して comment で残す Multi-Step Linear

## Validation 補助

design agent は doc path 参照が多いので、`--validate` の `Paths` チェック (referenced paths が存在するか) が肝。`prompts/steps/<c2>/<c3>/f_<edition>.md` を新規追加した直後に走らせ、ファイル名 typo を runtime 前に潰す。
