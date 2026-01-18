# Agent 構築ガイド（設定→実行→プロンプト連鎖）

AI 複雑性を抑えつつ、設定だけで実行可能な Agent を組み立てるための 「What と
Why」をまとめる。How（具体的なファイル作成手順）は `01_quickstart.md`
へ任せ、この文書では設計概念と実装の結び付きを説明する。

## 1. 全体連鎖の俯瞰

| レイヤー       | What（何を定義するか）                                                | Why（なぜ必要か）                                                        | 主な参照                                                                                  |
| -------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| 設定           | `agent.json`, `steps_registry.json`, schema, prompts                  | Flow/Completion ループが迷わないよう、開始点と遷移・検証条件を明文化する | `01_quickstart.md`, `02_agent_definition.md`, `design/02_prompt_system.md`                |
| 実行           | `AgentRunner` → Flow ループ → Completion ループ                       | 設定を元に状態遷移し、structured output を検証して完了可否を決める       | `design/01_runner.md`, `design/08_step_flow_design.md`, `design/03_structured_outputs.md` |
| プロンプト配置 | `.agent/<name>/prompts/system.md` と `steps/{c2}/{c3}/f_<edition>.md` | C3L/Climpt のルールでプロンプトを参照し、Fallback を排除する             | `design/02_prompt_system.md`, `design/08_step_flow_design.md`                             |

この 3 レイヤーは **設定 → 実行 → プロンプト** の一方向連鎖になっており、
どこかが欠落すると Runner が即停止する。暗黙のフォールバックを許さないことで
問題の原因を設定ファイルへ集約する、という設計哲学を実装している。

## 2. 設定レイヤーで決めること

1. **役割と入力** (`agent.json`)
   - What: Agent の ID、Completion Type、使用ツール、CLI 引数。
   - Why: 実行時に許可されたパーミッションと終了条件を固定し、設定変更だけで
     行動半径を制御するため。
2. **状態遷移** (`steps_registry.json`)
   - What: `entryStepMapping`、各 Step の `structuredGate`、`transitions`、
     `outputSchemaRef`。
   - Why: Flow ループに「どこから始まり、intent が何を意味し、どこへ遷移するか」
     を提示し、AI 応答を deterministic に扱うため。
3. **検証ルール** (Schema ファイル)
   - What: Step ごとの JSON Schema (`#/definitions/<stepId>` 形式)。
   - Why: Structured output を契約化し、失敗時に Flow を即座に停止させるため。
4. **C3L プロンプト配置** (`prompts/steps/...`)
   - What: `c2`/`c3`/`edition` でディレクトリを構成した Markdown。
   - Why: Runner が Step 設定から直接パスを導出し、設定ミスを検出できるように。

> 設定の目的は **「Runner に迷わず進ませる地図を渡すこと」** であり、地図が
> 不完全なら実行は開始されない。How が必要になったら Quickstart を参照する。

## 3. 実行レイヤーで起こること

1. **Boot** (`AgentRunner`)
   - What: `agent.json` と `steps_registry.json` を読み込み、Schema を解決。
   - Why: 不正な設定を実行前に弾き、失敗箇所を明示する。
2. **Flow ループ**
   - What: Step ごとに C3L プロンプトを呼び出し、Structured Gate で intent と
     handoff を抽出。
   - Why: Step 定義を唯一の真実として扱い、AI 応答の揺らぎを遷移ロジックに
     伝播させないため。
3. **Completion ループ**
   - What: Flow が `closure.<domain>` に遷移したとき、Completion Chain が
     structured output を検証し、Issue の状態や外部信号と照合。
   - Why: 「やりきったか？」を別ループに分離し、Flow を単純化するため。
4. **Fail-fast**
   - What: Schema 解決失敗や Intent 欠落を検出した時点で Flow を中断し、
     `FAILED_SCHEMA_RESOLUTION` 等で終了。
   - Why: 無限ループや不完全なワークフローを防ぎ、デバッグ範囲を設定ファイルに
     閉じ込めるため。

## 4. プロンプト配置と Resolver

- Flow Step は `c2` (=initial/continuation/closure) と `c3` (=completionType
  など) の組み合わせで固有ディレクトリを持つ。
- Runner は `design/08_step_flow_design.md` で規定された
  `pathTemplate`（デフォルト: `{c1}/{c2}/{c3}/f_{edition}.md`）で Markdown
  を解決する。
- `systemPromptPath` は共通の安全装置であり、Flow/Completion の文脈と一体で
  使う。個別 Step で追加の system prompt を書かない。
- Prompt から Structured Output を得る際は `design/03_structured_outputs.md` の
  フォーマットを遵守し、スキーマと intent 名を揃える。

> プロンプトは **設定された C3L 参照の結果としてのみ** 呼び出される。 Runner
> 内で文字列を直接埋め込むことはしない。

## 4.5 Intent Best Practices

| Intent    | When to Use                                  |
| --------- | -------------------------------------------- |
| `next`    | After completing part of the work            |
| `repeat`  | When current step needs retry                |
| `handoff` | **Only when ALL work is complete**           |
| `closing` | Only from closure steps to signal completion |

> **Warning**: Do NOT expose `handoff` on `initial.*` steps. Initial steps
> should proceed to continuation steps via `next`. Handoff from initial steps is
> allowed but emits a runtime warning. See `08_step_flow_design.md` Section 7.3.

### Step プロンプト作成時の注意点

Work step のプロンプトには以下を明示する:

- このステップは **特定のタスクのみ** を扱う（Issue
  を閉じたり別ステップの成果物をまとめない）
- 完了したら `next` で次のステップへ進む
- 全ての作業が終わった **continuation** ステップでのみ `handoff` を使用する

例:

```markdown
## このステップの責務

このステップでは **分析タスクのみ** を実行します。

- Issue を閉じません
- 別ステップの成果物をまとめません
- 分析が完了したら `next` で次のステップへ進みます
```

## 5. 実装との対応表

| 設定項目 / 概念               | 実装コンポーネント                                      | Why                                  | 参照                              |
| ----------------------------- | ------------------------------------------------------- | ------------------------------------ | --------------------------------- |
| `agent.json.behavior`         | `AgentRunner` (`agents/runner/runner.ts`)               | ループ全体の許可・制限を司る         | `design/01_runner.md`             |
| `steps_registry.json.steps.*` | `StepGateInterpreter`, `WorkflowRouter`                 | intent 解析と遷移の一元化            | `design/08_step_flow_design.md`   |
| `outputSchemaRef`             | `SchemaResolver` (`agents/common/schema-resolver.ts`)   | structured output の契約チェック     | `design/03_structured_outputs.md` |
| C3L プロンプト                | `PromptResolver` (`agents/prompts/resolver.ts`)         | 設定→実行→Markdown への橋渡し        | `design/02_prompt_system.md`      |
| Completion Type               | `CompletionChain` (`agents/runner/completion-chain.ts`) | Flow からの handoff を完了判定へ接続 | `design/05_core_architecture.md`  |

## 6. Agent 構築チェックリスト（What/Why ベース）

1. **目的を決める** — どの Completion Type が適合するか？ Why:
   終了条件を明確にし、 余計なステップを排除する。
2. **Step グラフを書く** — 初期/継続/完了の 3 段を紙に起こす。 Why: Structured
   Gate 設計を迷わないようにする。
3. **Schema を用意する** — 各 Step の JSON Pointer を定義。 Why: Runner が
   fail-fast できるよう、契約を先に決める。
4. **C3L プロンプトを配置** — Step グラフと同じ ID で Markdown を置く。 Why:
   設計とソース配置を 1:1 に保つ。
5. **設定を流し込む** — `agent.json` と `steps_registry.json` を作成。 Why:
   実装は設定ファイルだけに集約する。
6. **実行してログを読む** — Runner が停止したら設定へ戻って修正する。 Why:
   問題の責務を設定へ閉じ込めるという思想を守る。

---

このガイドは、設計哲学 (`docs/internal/ai-complexity-philosophy.md`) を
設定アーティファクトへ落とし込む際の索引である。詳細なサンプルやコマンドは
Quickstart を、Flow の細部は Step Flow Design を参照しつつ、ここで示した
連鎖を崩さないことが Agent 構築成功の近道となる。
