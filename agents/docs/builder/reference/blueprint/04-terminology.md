# 4. Terminology

## 原則

**Runtime の語彙をそのまま使う。** Blueprint 固有の用語は最小限。

## Blueprint 固有の用語 (3つのみ)

| 用語               | 意味                                                                      |
| ------------------ | ------------------------------------------------------------------------- |
| **Blueprint**      | agent + registry + schemas を統合した1つの JSON ファイル                  |
| **Splitter**       | Blueprint を agent.json + steps_registry.json + schemas/ に分割するツール |
| **Integrity Rule** | Blueprint Schema が検証する cross-ref ルール (R-A1〜R-F12)                |

## Runtime 用語 (そのまま使用)

Blueprint は以下の用語を Runtime から変更せずに使う:

### Agent 定義

| 用語        | 意味                       | 所在       |
| ----------- | -------------------------- | ---------- |
| name        | Agent の kebab-case 識別子 | agent.json |
| displayName | 人間可読な表示名           | agent.json |
| parameters  | CLI パラメータ定義         | agent.json |
| runner      | 実行設定の名前空間         | agent.json |

### Runner 設定

| 用語                 | 意味                 | 所在                           |
| -------------------- | -------------------- | ------------------------------ |
| verdict              | 完了判定戦略         | agent.json runner.verdict      |
| VerdictType          | 完了判定の種類 (8値) | agent.json runner.verdict.type |
| boundaries           | ツール・権限の制約   | agent.json runner.boundaries   |
| permissionMode       | 権限モード (4値)     | agent.json runner.boundaries   |
| allowedTools         | 使用可能ツール一覧   | agent.json runner.boundaries   |
| defaultClosureAction | 完了時の GitHub 操作 | agent.json runner.integrations |

### Step 定義

| 用語            | 意味                                                      | 所在                      |
| --------------- | --------------------------------------------------------- | ------------------------- |
| stepId          | Step の一意識別子                                         | steps_registry.json steps |
| stepKind        | Step の種類 (work / verification / closure)               | steps_registry.json steps |
| c2              | C3L Category (initial / continuation / closure / section) | steps_registry.json steps |
| c3              | C3L Classification                                        | steps_registry.json steps |
| edition         | プロンプトバリアント (default / failed / preparation 等)  | steps_registry.json steps |
| adaptation      | 失敗固有バリアント (git-dirty / test-failed 等)           | steps_registry.json steps |
| fallbackKey     | フォールバックプロンプトキー                              | steps_registry.json steps |
| uvVariables     | このステップが使う UV 変数名                              | steps_registry.json steps |
| usesStdin       | stdin 入力を受けるか                                      | steps_registry.json steps |
| outputSchemaRef | 出力 schema への参照 (file + schema)                      | steps_registry.json steps |

### フロー制御

| 用語             | 意味                                                                       | 所在                      |
| ---------------- | -------------------------------------------------------------------------- | ------------------------- |
| structuredGate   | 構造化出力からの intent 抽出設定                                           | steps_registry.json steps |
| allowedIntents   | このステップで許可される intent                                            | steps_registry.json steps |
| intentSchemaRef  | intent フィールドへの JSON Pointer                                         | steps_registry.json steps |
| intentField      | intent 値の抽出パス                                                        | steps_registry.json steps |
| GateIntent       | Intent の種類 (7値: next, repeat, jump, handoff, closing, escalate, abort) | Runtime 固定              |
| transitions      | intent → 次の step のマッピング                                            | steps_registry.json steps |
| entryStepMapping | verdict type → 開始 step のマッピング                                      | steps_registry.json       |

### バリデーション

| 用語            | 意味                         | 所在                           |
| --------------- | ---------------------------- | ------------------------------ |
| validators      | 検証コマンドの定義           | steps_registry.json            |
| failurePatterns | 検証失敗時のパターン定義     | steps_registry.json            |
| validationSteps | closure 前検証ステップの定義 | steps_registry.json            |
| extractParams   | 失敗時のパラメータ抽出ルール | steps_registry.json validators |

## v1 からの変更

v1 では Blueprint 固有の用語 (phase, receives, check, completion, expect 等)
を導入した。 v2 ではこれらを **全て廃止** し、Runtime 用語をそのまま使う。

理由:

1. AI は既存の config ファイルを読む機会がある。同じ語彙なら混乱しない。
2. 用語の翻訳テーブルが不要になる。
3. docs が「Blueprint では X、Runtime では Y」と書き分ける必要がなくなる。
