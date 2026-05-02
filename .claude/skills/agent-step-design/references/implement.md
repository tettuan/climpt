# Implement Agent — Best Practices

仕様 / issue を入力に、**コードや artifact を生成** し、外部状態 (git / gh / tests) で検証する。原型 C (Branching + Validator) に該当することが多い。原型の定義は [`archetypes.md`](./archetypes.md)、`failurePatterns` / `validators` の field 定義は [`registry-shape.md`](./registry-shape.md) を参照。

## Rules

| # | Rule |
|---|------|
| I1 | **線形 step + adaptation 列**: step は線形に並べ、失敗時の分岐は `failurePatterns` → `adaptation` 写像で表現する。`structuredGate.transitions` を多 target にしない (R2) |
| I2 | **Validator step は postLLM**: 外部コマンド (`git status --porcelain` 等) は `validators[*].phase: "postllm"` で実行し、結果を `failurePattern` に写す。LLM の自己申告で成功宣言させない |
| I3 | **Recovery prompt = adaptation file**: failure ごとに `f_failed_<adaptation>.md` を 1 ファイル用意し、recovery step ではなく **同じ step を edition `failed` で再実行** する。新 step を生やさない |
| I4 | **Worktree を有効化**: 副作用 (commit / branch) を伴う場合 `agent.json` の `runner.execution.worktree.enabled: true` を必ず立てる。本体作業ツリーを汚さない |
| I5 | **Handoff は次 step が必要なものだけ**: 重い artifact (生成ファイル全文) は handoff に乗せず、folder fallback (`.agent/climpt/tmp/.../<step-stem>/`) に置き path だけ handoff する |

## Step shape (典型 Branching + Validator)

```
plan (work) → impl (work) → verify-impl (work, validator) → closure
                                  │
                                  ├─ git-dirty       → adaptation: git-dirty
                                  ├─ branch-not-pushed → adaptation: branch-not-pushed
                                  └─ tests-failing   → adaptation: tests-failing
```

`failurePatterns` の宣言形と adaptation 写像規則は [`registry-shape.md`](./registry-shape.md) §`failurePatterns` を参照。adaptation prompt は `prompts/steps/<c2>/<c3>/f_failed_<adaptation>.md`。

## Anti-Patterns

- **Recovery を別 step に切る**: 同じ deliverable を扱うなら adaptation で復旧する。新 step を増やすと flow が分岐し R2 違反
- **Validator 不在**: 「LLM が done と言ったら done」にする → I2 違反。command 系 validator (`type: "command"`) を必ず 1 つ通す
- **Worktree skip**: ローカル本体で git 操作 → I4 違反。runner-subprocess-dispatch_test や finalize の前提が崩れる
- **Handoff bloat**: 生成コード全文を handoff に乗せる → schema validation が大きく重くなり、context もすぐ溢れる。folder fallback + path handoff にする

## 実例 citation

- `.agent/iterator/steps_registry.json` — `failurePatterns` で `git-dirty` 等を adaptation に写像し、`f_failed_<adaptation>.md` で recovery prompt を提供
- `.agent/iterator/agent.json` — `verdict.type: "poll:state"`, `maxIterations: 500`, worktree 有効
- `.agent/merger/agent.json` — implement の subset (PR merge 専用)。Single-Step archetype だが副作用ありの実例

## Validation 補助

`--validate` の `Handoff Inputs` チェックで、step A の `handoffFields` が step B の `uvVariables` / 入力期待と互換か検証される。実装系は handoff の依存が長くなりがちなので、step を 1 つ増減するたびに走らせる。
