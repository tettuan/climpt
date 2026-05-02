# Step Registry — Shape Reference

`steps_registry.json` の 1 step が持つ field と、prompt address (C3LAddress) の解決規則。本 skill の rule (R1–R4) と handoff 設計を言語化するための最小集合。

## Step record (必須 field)

| field | 型 | 役割 |
|-------|----|------|
| `stepId` | registry-unique string | step graph の node 識別子 |
| `stepKind` | `"work"` \| `"verification"` \| `"closure"` | dual loop の分岐 key (closure boundary が completion loop を起動) |
| `c2` | Category | `initial` / `continuation` / `closure` / `retry` / `section` |
| `c3` | Classification | `issue` / `polling` / `iteration` 等 (Category 内の細分) |
| `edition` | string | step variant (`default` / `preparation` / `processing` / `failed` / `precheck-*`) |
| `description` | string | 人間向け 1 行説明 (前提 / artifact / verdict を明文化する欄) |
| `outputSchemaRef` | `{ file, schemaId }` | LLM structured output の型契約 |
| `structuredGate` | object (下記) | SO の hinge field 抽出規則 |
| `transitions` | `Map<intent, stepId \| null>` | intent 別の next step (`null` = terminal) |

## `structuredGate` shape

```jsonc
{
  "allowedIntents": ["closing", "repeat"],   // この step が出してよい intent 集合
  "intentField":   "next_action.action",     // SO 中の唯一の hinge field の JsonPath
  "intentSchemaRef": { ... },                // hinge を enum で守る schema
  "fallbackIntent": "closing",               // hinge 未充足/unknown 時の安全 fallback
  "handoffFields": ["verdict", "summary"]    // 次 agent / 後続 step に渡す SO subpath
}
```

**single hinge 原則**: LLM ↔ orchestrator 間の state transition は必ず「1 つの schema の 1 つの宣言済み field」を経由する。自由文 parsing / hidden text-pattern routing は禁止。`fallbackIntent` を必ず宣言し、AI が verdict を欠落しても deterministic に閉じる。

## C3LAddress (prompt 解決の 5-tuple)

prompt は **address (5-tuple) で決まる**。CLI flag や runtime 条件で edition/adaptation を上書きする経路は構造的に存在しない。

| level | 値の例 | 役割 |
|-------|--------|------|
| `c1` | `steps`, `dev` | registry top-level namespace |
| `c2` | Category | step の大分類 |
| `c3` | Classification | Category 内の細分 |
| `edition` | `default` / `failed` / `precheck-*` | step variant |
| `adaptation?` | `git-dirty` / `empty` / `tests-failing` | failure-specific overlay (任意) |

### 解決 rule (two-tier, fail-fast)

1. `adaptation` 非空 → `pathTemplate(c1,c2,c3,edition,adaptation)` を試す
2. 不在なら `pathTemplateNoAdaptation(c1,c2,c3,edition)` に fallback
3. それも不在なら `TemplateNotFound` で fail-fast (silent embedded fallback は禁止)

既定 path: `{c1}/{c2}/{c3}/f_{edition}_{adaptation}.md` または `{c1}/{c2}/{c3}/f_{edition}.md`。

## `failurePatterns` (原型 C 専用)

```jsonc
"failurePatterns": {
  "git-dirty":         { "edition": "failed", "adaptation": "git-dirty" },
  "branch-not-pushed": { "edition": "failed", "adaptation": "branch-not-pushed" }
},
"validators": {
  "git-clean": {
    "type": "command", "phase": "postllm",
    "command": "git status --porcelain", "successWhen": "empty",
    "failurePattern": "git-dirty"
  }
}
```

failure ごとに `f_failed_<adaptation>.md` を 1 ファイル用意する。recovery 用に新 step を生やさず、**同じ step を edition `failed` で再実行**する (skill rule I3)。

## Boot validation (registry は frozen)

registry は Boot 時に validate され、Run 中は immutable。step graph の動的変更は禁止。`deno task agent --validate` の各 check (Schema / Cross-references / Paths / Handoff Inputs / UV Reachability) は本 shape の整合を逐次検証する。
