# Closure Output Contract

## Principle

**Agent decides WHAT, System executes HOW.**

Closure step の structured output は、AI の判断を System の副作用に変換する
**唯一の制御境界** である。AI がどのフィールドに何を書くかで、Issue のクローズ、
ラベル変更、Orchestrator の phase 遷移 が決定される。

System はフィールドの値を読んで実行するだけであり、値の解釈や変換は行わない。

## Structure / Contract

Closure step の structured output で System が読み取るフィールド一覧。

| フィールド            | 型                                                 | 必須 | 保証される動作                                                                                |
| --------------------- | -------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------- |
| `next_action.action`  | `"closing"` \| `"repeat"`                          | Yes  | `"closing"` → BoundaryHook が発火し完了処理を実行する。`"repeat"` → closure step を再実行する |
| `closure_action`      | `"close"` \| `"label-only"` \| `"label-and-close"` | No   | 指定した動作を実行する。未指定時は config `defaultClosureAction` → default `"close"`          |
| `verdict`             | string                                             | No   | Orchestrator に伝搬する。`outputPhases[verdict]` で phase 遷移 に使用される                   |
| `issue.labels.add`    | string[]                                           | No   | 指定したラベルを GitHub Issue に追加する                                                      |
| `issue.labels.remove` | string[]                                           | No   | 指定したラベルを GitHub Issue から削除する                                                    |
| `deferred_items`      | `Array<{title, body, labels}>`                     | No   | 各要素を新規 Issue として作成する。当該 Issue の close **より前** に実行される                |

これら以外のフィールド（`summary`, `status` 等）は Agent の内部状態であり、
System の副作用には影響しない。

### `deferred_items` の項目契約

各エントリは以下を満たす必要がある（schema で強制される）:

| プロパティ | 型       | 必須 | 追加制約                               |
| ---------- | -------- | ---- | -------------------------------------- |
| `title`    | string   | Yes  | `minLength: 1`（空文字は schema 違反） |
| `body`     | string   | Yes  | —                                      |
| `labels`   | string[] | Yes  | 空配列 `[]` も有効（pre-triage 状態）  |

未定義プロパティは `additionalProperties: false` で拒否される。schema 本体:
`.agent/{agent}/schemas/*.schema.json` の
`closure.*.properties.deferred_items`。

## Rules

### R1: 優先順位 — AI output > config > default

`closure_action` と `issue.labels` の両方に共通するルール:

```
AI structured output (動的)
  ↓ 未指定の場合
agent.json config (静的)
  ↓ 未指定の場合
framework default
```

| フィールド       | AI output                              | config                                                | default   |
| ---------------- | -------------------------------------- | ----------------------------------------------------- | --------- |
| `closure_action` | `structuredOutput.closure_action`      | `runner.integrations.github.defaultClosureAction`     | `"close"` |
| labels to add    | `structuredOutput.issue.labels.add`    | `runner.integrations.github.labels.completion.add`    | `[]`      |
| labels to remove | `structuredOutput.issue.labels.remove` | `runner.integrations.github.labels.completion.remove` | `[]`      |

### R2: ラベルのマージ

AI output と config のラベルは **union** される（重複排除）。 AI output が
config を「置き換える」のではなく「追加する」。

```
最終的な add    = Set(config.completion.add ∪ AI.issue.labels.add)
最終的な remove = Set(config.completion.remove ∪ AI.issue.labels.remove)
```

### R3: 2つのラベル系統

| 系統                | 実行タイミング                  | 対象ラベル                                           | 管理者                 |
| ------------------- | ------------------------------- | ---------------------------------------------------- | ---------------------- |
| Runner ラベル       | closure 時（BoundaryHook 内）   | 任意のラベル名                                       | agent.json + AI output |
| Orchestrator ラベル | phase 遷移時（dispatch 完了後） | `workflow.json` の `labelMapping` に定義されたラベル | workflow.json          |

この2系統は **独立** しており、互いに干渉しない。

### R4: verdict は自動変換されない

`verdict` フィールドは2つの経路で使われる:

1. **Orchestrator routing**: `verdict` → `DispatchOutcome.outcome` →
   `computeTransition(agent, outcome)` → `outputPhases[outcome]` → 次の phase
2. **AI のラベル判断材料**: AI が verdict の値に基づいて `issue.labels`
   を決定する

**System は verdict からラベルへの自動マッピングを行わない。**
`verdict: "approved"` と書いても "approved" ラベルが自動的に付くことはない。
ラベルが必要な場合は AI が `issue.labels.add` に明示的に含める。

これは Principle の帰結である: ラベルの選択は WHAT（AI の責務）であり、 System
は HOW（`gh issue edit --add-label`）のみを担う。

### R5: `deferred_items` は close intent に依存する

`deferred_items` の **宣言** は `closure_action` / `issue.labels` と独立して
可能だが、**実際の emission** は Orchestrator の close intent が `true` の場合に
のみ実行される（C2 guard, issue #485）。close intent が `false` のパス （verdict
が `blocked` に解決される場合など）では、宣言された `deferred_items` は no-op
となり、outbox に書き出されない。

これは、非 close パスで emit → 再 dispatch → 再 emit という重複作成を防止する
ための設計である。C1 の idempotency key は同一 structuredOutput に対してのみ有効
であり、再 dispatch 時に内容が変わると別 key が生成されるため、C1 単独では
重複を防げない。

- `verdict: "done"` + `deferred_items: [...]` → **emit される**。本 issue は
  完了扱い、派生は別 issue
- `verdict: "handoff-detail"` + `deferred_items: [...]` → agent config の
  `outputPhases` で close path に該当する場合のみ emit される
- `verdict: "blocked"` + `deferred_items: [...]` → **emit されない**（C2
  guard）。 close intent が false のため no-op

### R6: `deferred_items` は close より前に冪等に実行される

System は `deferred_items` の N 件を `create-issue` outbox アクションに展開し、
OutboxProcessor（Step 7b）で GitHub に送信する。Saga T6 の `closeIssue` は
OutboxProcessor 完了後に走る（`12_orchestrator.md` §「T1〜T7
シーケンス」参照）。

**不変条件（INV-ORDER）**: すべての `createIssue` は唯一の `closeIssue` より
**厳密に前** に実行される。派生 issue の起票失敗は本 issue の close を
ブロックする（fail-fast）。

**不変条件（INV-IDEMPOTENT）**: 同一 `deferred_items[i]` に対する `createIssue`
は **lifetime で 1 回のみ** 実行される。各アイテムの SHA-256 ハッシュ
（`title + body + sorted labels` の canonical JSON）を idempotency key として
`deferred-emitted-keys.json` に永続化し、再 emit 時にスキップする。key の
永続化は OutboxProcessor が全アクション成功した場合のみ行われるため、
`createIssue` が失敗した場合は次サイクルで再試行される（issue #484）。

### R7: `{title, body, labels}` は verbatim 転送される

System は `deferred_items[i]` のフィールドを **解釈・変換・フィルタせず** に
GitHub の `gh issue create` へ渡す。ラベルの並び順・大文字小文字・重複はすべて
AI が指定した通りに保持される。これは R4 と同じ Principle の帰結である:
「何を起票するか」は AI の責務（WHAT）、「どう gh を叩くか」は System
の責務（HOW）。

### R8: 空配列 / 欠落は no-op（後方互換）

`deferred_items` が `[]` / `null` / 未定義 のいずれでも副作用は発生しない。 既存
agent は schema の optional 宣言により無変更で動作し続ける。

## Patterns

### P1: close-and-done

最もシンプル。Issue をクローズして終了。

- **用途**: 作業完了、特別なラベル操作不要
- **使うフィールド**: `next_action.action = "closing"`
- **使わないフィールド**: `closure_action`, `verdict`, `issue.labels`
- **動作**: default の `"close"` が適用 → Issue クローズ

### P2: label-without-close

Issue は OPEN のまま、ラベルだけ変更する。

- **用途**: phase 遷移のために状態ラベルを更新するが、Issue は継続
- **使うフィールド**: `next_action.action = "closing"`,
  `closure_action = "label-only"`
- **使わないフィールド**: `verdict` (任意), `issue.labels` (config で十分な場合)
- **動作**: config の `completion.add/remove` でラベル更新 → Issue は OPEN

### P3: verdict-driven labels

AI が verdict に基づいてラベルを動的に決定する。

- **用途**: reviewer/validator agent が verdict に応じて異なるラベルを付与
- **使うフィールド**: 全フィールド
- **ポイント**: `verdict` は routing 用、`issue.labels` はラベル用。
  両者は独立しており、AI が両方を一貫性を持って出力する責務を負う
- **動作**: AI が verdict に応じた labels を出力 → config ラベルとマージ → 適用
  → Orchestrator が verdict で phase 遷移

### P4: verdict routing only

Orchestrator の phase 遷移 に verdict を使うが、ラベル操作は config に任せる。

- **用途**: ラベルは Orchestrator の `labelMapping` で管理し、 Runner
  側では追加ラベル不要
- **使うフィールド**: `next_action.action = "closing"`, `verdict`
- **使わないフィールド**: `issue.labels` (Orchestrator が管理)
- **動作**: BoundaryHook は config ラベルのみ適用 → Orchestrator が
  `computeTransition(agent, verdict)` で phase 遷移 → `computeLabelChanges()` で
  workflow ラベル更新

## Concrete Examples

### P3 の適用例: reviewer agent の verdict-driven labels

#### closure step schema (抜粋)

```json
{
  "properties": {
    "next_action": {
      "type": "object",
      "properties": {
        "action": { "enum": ["closing", "repeat"] }
      }
    },
    "verdict": { "enum": ["approved", "changes_requested"] },
    "closure_action": {
      "enum": ["close", "label-only", "label-and-close"],
      "default": "label-and-close"
    },
    "issue": {
      "type": "object",
      "properties": {
        "labels": {
          "type": "object",
          "properties": {
            "add": { "type": "array", "items": { "type": "string" } },
            "remove": { "type": "array", "items": { "type": "string" } }
          }
        }
      }
    }
  }
}
```

#### agent.json config (抜粋)

```json
{
  "runner": {
    "integrations": {
      "github": {
        "enabled": true,
        "labels": {
          "completion": {
            "add": [],
            "remove": ["needs-review"]
          }
        },
        "defaultClosureAction": "label-and-close"
      }
    }
  }
}
```

#### AI が approved を返した場合

structured output:

```json
{
  "next_action": { "action": "closing" },
  "verdict": "approved",
  "closure_action": "label-and-close",
  "issue": {
    "labels": {
      "add": ["reviewed"],
      "remove": []
    }
  }
}
```

System の動作:

```
1. BoundaryHook 発火 (next_action.action === "closing")
2. verdict "approved" を VerdictHandler に格納
3. closure_action "label-and-close" を解決 (AI output が優先)
4. ラベルマージ:
   add    = Set(config[] ∪ AI["reviewed"]) = ["reviewed"]
   remove = Set(config["needs-review"] ∪ AI[]) = ["needs-review"]
5. gh issue edit --add-label reviewed --remove-label needs-review
6. gh issue close
7. AgentResult.verdict = "approved"
8. Orchestrator: resolveOutcome(validator, result) → "approved"
9. computeTransition(agent, "approved") → outputPhases["approved"]
```

#### AI が changes_requested を返した場合

structured output:

```json
{
  "next_action": { "action": "closing" },
  "verdict": "changes_requested",
  "closure_action": "label-only",
  "issue": {
    "labels": {
      "add": ["needs-changes"],
      "remove": []
    }
  }
}
```

System の動作:

```
1. BoundaryHook 発火
2. verdict "changes_requested" を格納
3. closure_action "label-only" → Issue は OPEN のまま
4. ラベルマージ:
   add    = ["needs-changes"]
   remove = ["needs-review"]
5. gh issue edit --add-label needs-changes --remove-label needs-review
6. (Issue は閉じない)
7. AgentResult.verdict = "changes_requested"
8. Orchestrator: outputPhases["changes_requested"] → revision phase
```

## 実装ファイル

| コンポーネント              | パス                                         | 関連 Level           |
| --------------------------- | -------------------------------------------- | -------------------- |
| BoundaryHook dispatcher     | `agents/runner/boundary-hooks.ts`            | Structure            |
| ExternalStateVerdictAdapter | `agents/verdict/external-state-adapter.ts`   | Rules (R1, R2, R4)   |
| CompletionLoopProcessor     | `agents/runner/completion-loop-processor.ts` | Structure (発火条件) |
| resolveOutcome              | `agents/orchestrator/dispatcher.ts`          | Rules (R4)           |
| computeTransition           | `agents/orchestrator/phase-transition.ts`    | Rules (R3)           |
| computeLabelChanges         | `agents/orchestrator/phase-transition.ts`    | Rules (R3)           |
| Issue closure schema        | `.agent/*/schemas/issue.schema.json`         | Structure            |

## 関連ドキュメント

- [02_agent_definition.md](./02_agent_definition.md) -- verdict propagation,
  `runner.integrations.github` config
- [08_github_integration.md](./08_github_integration.md) -- 3層アクセスモデル,
  BoundaryHook 発火条件, Orchestrator/Handoff
- [06_workflow_setup.md](./06_workflow_setup.md) -- `labelMapping`,
  `outputPhases`, phase 遷移
