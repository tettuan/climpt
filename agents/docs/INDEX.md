# Agents ドキュメント

汎用 Agent ランタイムは「普遍的な設計」と「その設計を使って Agent
を追加する手引き」の
二本立てで成り立っている。迷ったらまずここで現在地を確認してほしい。

## 汎用 Agent の設計

Flow/Completion の哲学、境界、C3L、Structured Output など、すべての Agent
が共有する 仕組みを記述した資料群。ファイルは `agents/docs/design/`
にまとまっている。

| ファイル                          | 内容                                                        |
| --------------------------------- | ----------------------------------------------------------- |
| `design/01_runner.md`             | AgentRunner の責務、ワークツリー処理、権限制御。            |
| `design/02_prompt_system.md`      | C3L/Climpt プロンプト解決と `pathTemplate`。                |
| `design/03_structured_outputs.md` | Structured Output/FormatValidator/リトライ設計。            |
| `design/04_philosophy.md`         | AI 複雑性と戦う設計哲学。「Agent = 設定 + ループ + 判定」。 |
| `design/05_core_architecture.md`  | Flow/Completion 二重ループと境界の整理。                    |
| `design/06_contracts.md`          | StepContext や CompletionChain の契約、I/O、失敗条件。      |
| `design/07_extension_points.md`   | 差し替え可能な拡張ポイントと制約。                          |
| `design/08_step_flow_design.md`   | Flow Step の strict gate 仕様と handoff 設計。              |
| `design/09_model_selection.md`    | ステップごとのモデル選択と解決優先順位。                    |

## 汎用 Agentを利用したエージェント追加方法

設計を踏まえて、新しい Agent を設定だけで追加・移行するためのガイド群。
ファイルは `agents/docs/builder/` にまとめた。

| ファイル                                 | 内容                                                   |
| ---------------------------------------- | ------------------------------------------------------ |
| `builder/01_quickstart.md`               | 具体的なディレクトリ構成と必須パラメータの手順。       |
| `builder/02_agent_definition.md`         | `agent.json` のスキーマ詳細。                          |
| `builder/03_builder_guide.md`            | 設定→実行→プロンプト連鎖を What/Why で俯瞰するガイド。 |
| `builder/04_config_system.md`            | デフォルト/ユーザー/CLI のマージ規則。                 |
| `builder/05_troubleshooting.md`          | よくある問題と解決方法（構造化出力、ログの読み方）。   |
| `builder/migration_guide.md`             | 既存 Agent を v2 設計へ移行するための手順。            |
| `builder/migration_incompatibilities.md` | 非互換点と回避策の一覧。                               |
| `builder/migration_template.md`          | 移行作業を記録するテンプレート。                       |

## 思考実験の記録（参考）

222 の観点で穴を探したログ。必要に応じて `docs/internal/` を参照。

| 実験    | 焦点               | 発見数 | 累計 |
| ------- | ------------------ | ------ | ---- |
| Gecko   | 基本ループ         | 26     | 26   |
| Rudder  | ステップ遷移       | 38     | 64   |
| Saucier | 並列実行（除外）   | 46     | 110  |
| Welder  | 複数インスタンス   | 100    | 210  |
| Tailor  | ステップ間引き継ぎ | 12     | 222  |

### 主要な発見

- **Gecko**: ループは単純に保つ
- **Rudder**: 遷移ロジックを Agent から分離
- **Saucier**: 並列実行は Agent の責務外
- **Welder**: 1 Issue = 1 Branch = 1 Worktree = 1 Instance
- **Tailor**: ステップ出力は名前空間で衝突を防止

## 禁止事項（抜粋）

- Agent 内並列実行
- リソースロック
- 暗黙のデフォルト
- 複雑なブランチ戦略
- ステップ間の暗黙参照
