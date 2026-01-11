# Agents Documentation Index

## 設計の階層構造

```
┌─────────────────────────────────────────────────────────────┐
│  00_abstraction_layers.md   ← 最上位: 設計の基準            │
│  (Layer -1 〜 Layer 4)                                      │
├─────────────────────────────────────────────────────────────┤
│  04_design_contracts.md     ← 契約: インターフェース境界     │
│  (事前条件/事後条件/副作用)                                  │
├─────────────────────────────────────────────────────────────┤
│  01-03, 05-08               ← 各コンポーネント詳細           │
│  (既存ドキュメント)                                          │
├─────────────────────────────────────────────────────────────┤
│  09_implementation_details.md ← 実装決定事項                 │
│  (具体的な設計判断)                                          │
└─────────────────────────────────────────────────────────────┘
```

## 基準ドキュメント（2025-01 設計）

以下の3ファイルが設計の基準。他のドキュメントはこれらに整合するよう見直す。

**思考実験による検証**:

- `tmp/gecko/` - 動物名（gecko）で26個の穴を発見
- `tmp/rudder/` - 乗物操作名（rudder）で38個の穴を発見
- `tmp/saucier/` - コース料理名（saucier）で46個の穴を発見
- 合計110個の設計観点を反映済み

| ファイル                       | 抽象度 | 内容                | 役割                     |
| ------------------------------ | ------ | ------------------- | ------------------------ |
| `00_abstraction_layers.md`     | 最高   | 6層の抽象化レイヤー | **設計の骨格**           |
| `04_design_contracts.md`       | 高     | 各レイヤーの契約    | **インターフェース定義** |
| `09_implementation_details.md` | 低     | 実装の具体的決定    | **実装ガイドライン**     |

### 00_abstraction_layers.md

設計の最上位。全コンポーネントはこのレイヤー構造に従う。

```
Layer -1: Configuration  - 設定読み込み、依存組み立て
Layer  0: Lifecycle      - 起動から停止までの全体制御
Layer  1: Loop           - 実行ループの制御
Layer  1.5: Scheduler    - 並列実行、リソース管理、同期（Saucier実験で発見）
Layer  2: SDK Bridge     - Claude Agent SDKとの接続
Layer  3: Completion     - 完了条件の判定
Layer  3.5: StepCheck    - ステップ単位の遷移判定（Rudder実験で発見）
Layer  4: Prompt         - 外部プロンプトの解決
```

### 04_design_contracts.md

各レイヤーのインターフェース契約を定義。

- 入力契約（事前条件）
- 出力契約（事後条件）
- 状態契約（不変条件）
- 副作用の明示

### 09_implementation_details.md

具体的な実装判断を記録。

- load/validateの関係
- 依存オブジェクト生成順序
- carry更新ルール
- ステップ遷移ロジック

## 既存ドキュメント（要見直し）

以下は基準ドキュメントに整合するよう見直しが必要。

| ファイル                     | Layer対応  | 見直し観点                 |
| ---------------------------- | ---------- | -------------------------- |
| `01_architecture.md`         | 全体       | Layer構造との整合          |
| `02_agent_definition.md`     | Layer -1   | Configuration契約との整合  |
| `03_runner.md`               | Layer 0, 1 | Lifecycle/Loop契約との整合 |
| `05_prompt_system.md`        | Layer 4    | PromptResolver契約との整合 |
| `06_action_system.md`        | Layer 1, 3 | Completion連携の明確化     |
| `07_config_system.md`        | Layer -1   | Configuration契約との整合  |
| `08_implementation_guide.md` | 全体       | 09との統合検討             |

## その他のドキュメント

| ファイル              | 状態 | 備考                             |
| --------------------- | ---- | -------------------------------- |
| `step_flow_design.md` | 参考 | StepMachine設計の参考資料        |
| `migration_*.md`      | 参考 | マイグレーション用（必要時参照） |

## 見直しの優先順位

1. **03_runner.md** - Lifecycle/Loop/Completionの中核
2. **02_agent_definition.md** - Configuration層の入力定義
3. **05_prompt_system.md** - Prompt層の詳細
4. **06_action_system.md** - Completion連携
5. **07_config_system.md** - Configuration層の詳細
6. **01_architecture.md** - 全体構造の更新
7. **08_implementation_guide.md** - 09との統合

## 設計原則（00から抜粋）

1. **単方向依存**: 上位レイヤーは下位レイヤーに依存。逆方向禁止。
2. **インターフェース境界**: 各レイヤーは明確なインターフェースを定義。
3. **状態の局所性**: 状態変更は可能な限り一箇所に集約。
4. **副作用の明示**: 副作用を持つメソッドは名前やシグネチャで明示。
