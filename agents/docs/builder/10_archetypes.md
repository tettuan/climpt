# 10. Agent Archetypes (実例分類)

新しい Agent を設計するとき、ゼロから組むより「既存のどれに一番近いか」を
選ぶ方が速い。このページは `.agent/` 配下の実在エージェントを **3 原型** に
分類し、`agent.json` / `steps_registry.json` / prompt 配置の差分だけを並べる。

> `.agent/` は Climpt 開発用の検証対象であり、**再利用テンプレートではない**
> (`.agent/CLAUDE.md` 参照)。ここでは「同じ原型の最も近い実例」として参照し、
> 自エージェントの設計時に構造を比較するための地図として使う。

## 3 原型の要点

| 原型                     | Step 数 | VerdictType       | Validator / failurePattern        | 典型例               | 適合する状況                                         |
| ------------------------ | ------: | ----------------- | --------------------------------- | -------------------- | ---------------------------------------------------- |
| A. Single-Step           |       1 | `count:iteration` | なし                              | triager, merger      | 1 ループで完結する transformer。状態機械が不要。     |
| B. Multi-Step Linear     |     2–N | `count:iteration` | なし (structuredGate のみ)        | considerer, detailer | Step が直列。gate の intent で遷移するが分岐しない。 |
| C. Branching + Validator |      N+ | `poll:state` 等   | あり (failurePattern で recovery) | iterator, reviewer   | 外部状態に応じて分岐し、失敗時に adaptation で復旧。 |

## 実例マップ (`.agent/*/agent.json` ベース)

| Agent      | 原型 | Verdict                 | maxIter | 分岐 | GitHub 連携   | 根拠ファイル                            |
| ---------- | ---- | ----------------------- | ------: | :--: | ------------- | --------------------------------------- |
| triager    | A    | `count:iteration`       |       1 |  ✗   | label apply   | `.agent/triager/agent.json`             |
| merger     | A    | `count:iteration`       |       1 |  ✗   | PR merge      | `.agent/merger/agent.json`              |
| clarifier  | A    | `count:iteration`       |       1 |  ✗   | label juggle  | `.agent/clarifier/agent.json`           |
| considerer | B    | `count:iteration`       |       1 |  ✓   | issue close   | `.agent/considerer/steps_registry.json` |
| detailer   | B    | `count:iteration`       |       1 |  ✓   | comment only  | `.agent/detailer/agent.json`            |
| iterator   | C    | `poll:state`            |     500 |  ✓   | full cycle    | `.agent/iterator/steps_registry.json`   |
| reviewer   | C    | `poll:state/issueClose` |     300 |  ✓   | review verify | `.agent/reviewer/steps_registry.json`   |

「分岐 ✓」は `structuredGate.transitions` が複数 target を持つか、
`validationSteps` で条件付き回復が定義されていることを意味する。

## 原型 A — Single-Step (triager)

**特徴**: 1 iteration で一連の処理を完結させる。AI 応答は intent 分岐せず
`closing` 一方向。

```json
// agent.json (抜粋)
"verdict": { "type": "count:iteration", "config": { "maxIterations": 1 } }

// steps_registry.json (抜粋)
{
  "entryStepMapping": { "count:iteration": "triage" },
  "steps": {
    "triage": {
      "stepId": "triage",
      "stepKind": "closure",
      "c2": "closure",
      "c3": "triage",
      "edition": "default"
    }
  }
}
```

**prompt 配置**: `prompts/steps/closure/triage/f_default.md` の 1 ファイルのみ。

**選ぶとき**: 「入力 1 つ → 処理 → ラベル / コメント / close」の単発変換。
完了条件が外部状態ではなく「1 回実行したか」でよい場合。

## 原型 B — Multi-Step Linear (considerer)

**特徴**: Step は複数ありえるが、遷移は線形。`structuredGate` の intent は
`closing` / `repeat` の 2 択で、分岐 branch を持たない。

```json
// steps_registry.json (抜粋)
"consider": {
  "stepId": "consider",
  "stepKind": "closure",
  "structuredGate": {
    "allowedIntents": ["closing", "repeat"],
    "intentField": "next_action.action",
    "fallbackIntent": "closing"
  },
  "transitions": {
    "closing": { "target": null },
    "repeat":  { "target": "consider" }
  },
  "outputSchemaRef": {
    "file": "considerer.schema.json",
    "schema": "closure.consider"
  }
}
```

**prompt 配置**: Step ごとに 1 editon。`repeat` 時は同じ step を再実行するため
prompt 追加は不要。

**選ぶとき**: Step 間で handoff を通すが、外部状態に応じた分岐は要らない。 AI
が「もう一度考える」と判断したら同じ step に戻れば十分なケース。

## 原型 C — Branching + Validator (reviewer)

**特徴**: 外部コマンド (git / gh / tests) で状態を検証し、失敗 `failurePattern`
を adaptation に写像して recovery prompt を呼び出す。

```json
// steps_registry.json (抜粋)
"failurePatterns": {
  "git-dirty":          { "edition": "failed", "adaptation": "git-dirty" },
  "branch-not-pushed":  { "edition": "failed", "adaptation": "branch-not-pushed" },
  "branch-not-merged":  { "edition": "failed", "adaptation": "branch-not-merged" }
},
"validators": {
  "git-clean": {
    "type": "command",
    "phase": "postllm",
    "command": "git status --porcelain",
    "successWhen": "empty",
    "failurePattern": "git-dirty"
  }
},
"validationSteps": {
  "closure.review": {
    "preflightConditions": [],
    "postLLMConditions": [ /* 検証チェーン */ ]
  }
}
```

**prompt 配置**: Step ごとに `f_default.md` + failure 別の
`f_failed_{adaptation}.md`。`pathTemplate` は既定の
`{c1}/{c2}/{c3}/f_{edition}_{adaptation}.md`。

**選ぶとき**: 成果物 (branch / PR / 成果ファイル) の妥当性を機械的に検証したい。
検証が失敗した瞬間に、失敗理由に応じた recovery prompt を LLM に渡し直したい。

## 差分一覧 (赤字相当のみ)

| 観点               | A. Single-Step      | B. Linear               | C. Branching + Validator           |
| ------------------ | ------------------- | ----------------------- | ---------------------------------- |
| `verdict.type`     | `count:iteration`   | `count:iteration`       | `poll:state` / `detect:structured` |
| `maxIterations`    | 1                   | 1                       | 50–500                             |
| `entryStepMapping` | 1 エントリ          | 1 エントリ              | 複数 (verdict 毎 / initial 毎)     |
| `structuredGate`   | 任意 (closing 単一) | 必須 (closing + repeat) | 必須 (next / repeat / closing)     |
| `transitions`      | 不要                | 自己ループ or `null`    | 複数 target (分岐あり)             |
| `failurePatterns`  | 不要                | 不要                    | **必須** (recovery の前提)         |
| `validators`       | 不要                | 不要                    | **必須** (command type が一般)     |
| `validationSteps`  | 不要                | 不要                    | 必須                               |
| `outputSchemaRef`  | closure のみ        | 全 step                 | 全 step + validation step          |
| prompt edition 数  | 1 (`default`)       | step 数と同じ           | `default` + `failed` × adaptation  |
| worktree           | 不要 (通常)         | 不要 (通常)             | 推奨 (`execution.worktree`)        |

## 新規 Agent を作るときの判定フロー

```
1 iteration で終わるか?
 ├─ YES → 原型 A (triager / merger を参照)
 └─ NO  → 分岐が要るか?
           ├─ NO  → 原型 B (considerer / detailer を参照)
           └─ YES → 外部状態を検証するか?
                     ├─ YES → 原型 C (reviewer / iterator を参照)
                     └─ NO  → B の transitions を多方向化して再検討
```

## 関連ドキュメント

- [03_builder_guide.md](./03_builder_guide.md) — 各原型に共通する What/Why
- [07_flow_design.md](./07_flow_design.md) — 分岐設計の判断根拠 (原型 C)
- [09_closure_output_contract.md](./09_closure_output_contract.md) — closure
  出力契約
- [../design/04_step_flow_design.md](../design/04_step_flow_design.md) — gate
  仕様
- [../design/05_structured_outputs.md](../design/05_structured_outputs.md) —
  Schema 連鎖
