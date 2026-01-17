Agent のテストを開始を開始する。
設定とプロンプトで作成可能なので、以下の手順でテストする。

## スキーマ解決失敗時の停止ルール（Fail-Fast）

**重要**: スキーマ解決に失敗した場合、ランナーは以下のルールで動作します：

1. **1回目の失敗**: 警告ログを出力し、`StructuredOutputUnavailable` として StepGate をスキップ。同じステップで次のイテレーションを試行。
2. **2回連続の失敗**: `FAILED_SCHEMA_RESOLUTION` エラーで即座に停止。無限ループを防止。

### ログメッセージ
- `[SchemaResolution] Failed to resolve schema pointer (failure N/2)` - スキーマポインタ解決失敗
- `[SchemaResolution] Marking iteration as StructuredOutputUnavailable` - StepGate スキップ
- `FAILED_SCHEMA_RESOLUTION` - 2回連続失敗で停止

### よくある原因と対処
| 原因 | 対処法 |
|------|--------|
| `outputSchemaRef.schema` が bare name (`"initial.default"`) | JSON Pointer 形式に変更: `"#/definitions/initial"` |
| `schemas/step_outputs.schema.json` が存在しない | スキーマファイルを作成 |
| ポインタ先の `definitions` が存在しない | スキーマファイルに定義を追加 |

### 参照
- `agents/docs/builder/01_quickstart.md` - スキーマ設定の正しい形式
- `agents/docs/design/step_flow_design.md` - Flow ステップの要件

---

テスト方法：ランダムテスト
テスト概要：エージェント名を、以下の「ジャンル」からランダムに選び、選んだジャンルの中から、さらに特定の作業プロセス名称をランダムに決める。これを「エージェント名」とする。
テストの目的： 複数ステップ、ステップの手戻りを伴う、他段階で30近いステップ実行のエージェント構築と実装の容易性を確認する。（最低5step以上、30ステップ以内）

その後、以下の「手順」に従う。

## ジャンル

ランダム値は、新たなbash実行から得ること。

- 家事
- 移動
- 買い物
- 記事作成
- ソフトウェア開発
- 本屋
- 花屋
- 芸能
- スポーツ練習
- 経理
- 広報
- デザイン受託
- その他分野からランダムに選ぶ

## 手順

1. quickガイドをもとにエージェントを構築する（既存実装を参照しない）
  `agents/docs/builder/01_quickstart.md` と `agents/docs/design/step_flow_design.md`
  - `entryStepMapping.stepMachine` または `entryStep` を**必ず**定義する
  - `.agent/{agent}/schemas/*.schema.json` を作成し、すべての Flow/Completion Step に `outputSchemaRef` を設定する
  - プロンプトには Structured Output (JSON) を**強制**する記述を追加し、`next_action.action` を明示させる（`isTerminal` には頼らない）
1-1. エージェントに応じて、ステップを決め、対応するプロンプトも作ること
1-2. ブランチを `test/validation` ブランチに維持すること
1-3. ブランチは最終的に破棄するため、コミットは不要
2. 構築したエージェントへ依頼する内容を issue へ書く
4. 実行手順を tmp/building-agent-test/tests/ 配下に階層を作って作成し、ログの書き出される場所も記す
4-1. gh issue 番号を示した実行CLIを示す（実行はしない）
4-2. 期待する実行結果を記載する（プロンプトやissueから、予測される結果を導き出す）

---

実行手順に従い、他のプロセス（Termina）から実行する。これは待機していること。（あなたが実行しない）

---

実行した報告をもとに、あなたログを監視する。
問題点を把握し、記録する。修正はしない。

---


### 問題点の記録

- tmp/building-agent-test/troubles/ 配下に階層を作って、都度問題点を記録する。起きたことを書くこと。

問題点の例：
- 示された情報だけではなく、既存実装を調べるような手順を考慮してしまうこと（ドキュメントからの指示が不足）
