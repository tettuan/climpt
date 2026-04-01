# Agent Builder Guide

Climpt Agent の構築ガイド。

---

## 構築順序

Agent を作成する際は、以下の順序で進める。

```
1. 目的と完了条件を決める     → verdictType の選択
2. agent.json を作成          → Agent 定義
3. steps_registry.json を作成 → Step 遷移の定義
4. Schema を用意              → Structured Output の契約
5. プロンプトを配置           → C3L 構造に従う
6. 実行して検証               → --validate → 本実行
```

## ドキュメント一覧

### 構築ガイド（この順で読む）

| # | ドキュメント                                           | 内容                   | いつ読むか                            |
| - | ------------------------------------------------------ | ---------------------- | ------------------------------------- |
| 1 | [01_quickstart.md](./01_quickstart.md)                 | ファイル作成手順       | **最初に読む** - 手を動かしながら学ぶ |
| 2 | [02_agent_definition.md](./02_agent_definition.md)     | agent.json の詳細      | agent.json を書くとき                 |
| 3 | [03_builder_guide.md](./03_builder_guide.md)           | 設計思想と連鎖         | 設計を理解したいとき                  |
| 4 | [04_config_system.md](./04_config_system.md)           | 設定の優先順位         | 実行時設定を変えたいとき              |
| 5 | [05_troubleshooting.md](./05_troubleshooting.md)       | トラブルシューティング | 問題が発生したとき                    |
| 6 | [06_workflow_setup.md](./06_workflow_setup.md)         | ワークフロー設定       | 複数 Agent を連携させるとき           |
| 7 | [07_github_integration.md](./07_github_integration.md) | GitHub 連携ガイド      | GitHub 操作の全体像を知りたいとき     |

### リファレンス

| ドキュメント                                                     | 内容                                 |
| ---------------------------------------------------------------- | ------------------------------------ |
| [reference/agent.yaml](./reference/agent.yaml)                   | agent.json 全フィールド解説          |
| [reference/steps_registry.yaml](./reference/steps_registry.yaml) | steps_registry.json 全フィールド解説 |

---

## 注意点

### Runner の Fail-Fast 動作

Runner は設定不備を検出すると即座に停止する。曖昧なフォールバックは行わない。

| エラー                     | 原因                                | 対処                                    |
| -------------------------- | ----------------------------------- | --------------------------------------- |
| `No entry step configured` | `entryStepMapping` 未設定           | verdictType に対応するエントリを追加    |
| `Flow validation failed`   | `structuredGate`/`transitions` 欠落 | すべての Step に定義を追加              |
| `Schema resolution failed` | `outputSchemaRef` のパス不正        | JSON Pointer と定義名を一致させる       |
| `No intent produced`       | Structured Output なし              | Schema に `next_action.action` を含める |

### Step 種別と許可 Intent

| 種別         | パターン                      | 許可 Intent                  | 禁止    |
| ------------ | ----------------------------- | ---------------------------- | ------- |
| Work         | `initial.*`, `continuation.*` | next, repeat, jump, handoff  | closing |
| Verification | `verification.*`              | next, repeat, jump, escalate | closing |
| Closure      | `closure.*`                   | closing, repeat              | -       |

> **重要**: `closing` を返せるのは Closure Step のみ。Work Step
> から直接完了させることはできない。

---

## 関連ドキュメント

### 設計ドキュメント

| ドキュメント                                                          | 内容                   |
| --------------------------------------------------------------------- | ---------------------- |
| [design/06_runner.md](../design/06_runner.md)                         | Runner アーキテクチャ  |
| [design/07_prompt_system.md](../design/07_prompt_system.md)           | C3L プロンプトシステム |
| [design/05_structured_outputs.md](../design/05_structured_outputs.md) | Structured Output      |
| [design/04_step_flow_design.md](../design/04_step_flow_design.md)     | Step Flow 設計         |

### その他

- [agents/README.md](../../README.md) - Agent フレームワーク概要
- [Scaffolder Plugin](../../../plugins/climpt-agent-scaffolder/) - Agent
  雛形生成
