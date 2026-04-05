# Closure Output Contract

## Principle

**Agent decides WHAT, System executes HOW.**

Closure step の structured output は、AI の判断を System の副作用に変換する
**唯一の制御境界** である。AI がどのフィールドに何を書くかで、Issue のクローズ、
ラベル変更、Orchestrator の phase 遷移 が決定される。

System はフィールドの値を読んで実行するだけであり、値の解釈や変換は行わない。

## Structure / Contract

Closure step の structured output で System が読み取るフィールド一覧。

| フィールド            | 型                                                 | 必須 | 保証される動作                                                                       |
| --------------------- | -------------------------------------------------- | ---- | ------------------------------------------------------------------------------------ |
| `next_action.action`  | `"closing"` \| `"continue"`                        | Yes  | `"closing"` → BoundaryHook が発火する。それ以外 → 何も起きない                       |
| `closure_action`      | `"close"` \| `"label-only"` \| `"label-and-close"` | No   | 指定した動作を実行する。未指定時は config `defaultClosureAction` → default `"close"` |
| `verdict`             | string                                             | No   | Orchestrator に伝搬する。`outputPhases[verdict]` で phase 遷移 に使用される          |
| `issue.labels.add`    | string[]                                           | No   | 指定したラベルを GitHub Issue に追加する                                             |
| `issue.labels.remove` | string[]                                           | No   | 指定したラベルを GitHub Issue から削除する                                           |

これら以外のフィールド（`summary`, `status` 等）は Agent の内部状態であり、
System の副作用には影響しない。

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
        "action": { "enum": ["closing", "continue"] }
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
8. Orchestrator: mapResultToOutcome → "approved"
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
| mapResultToOutcome          | `agents/orchestrator/dispatcher.ts`          | Rules (R4)           |
| computeTransition           | `agents/orchestrator/phase-transition.ts`    | Rules (R3)           |
| computeLabelChanges         | `agents/orchestrator/phase-transition.ts`    | Rules (R3)           |
| Issue closure schema        | `.agent/*/schemas/issue.schema.json`         | Structure            |

## 関連ドキュメント

- [02_agent_definition.md](./02_agent_definition.md) -- verdict propagation,
  `runner.integrations.github` config
- [07_github_integration.md](./07_github_integration.md) -- 3層アクセスモデル,
  BoundaryHook 発火条件, Orchestrator/Handoff
- [06_workflow_setup.md](./06_workflow_setup.md) -- `labelMapping`,
  `outputPhases`, phase 遷移
