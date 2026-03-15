# AgentBlueprint Language Specification

## 概要

AgentBlueprint は、Climpt Agent Runner の設定ファイル群 (agent.json,
steps_registry.json, schemas/) の **Schema 間整合性ルール**
を形式化する言語である。

## この言語が解決する問題

Agent Runner の設定は3つの JSON
ファイルに分散し、38の相互参照ルールで結ばれている。これらのルールは現在、docs
(自然言語、揺れあり)、validator.ts (TypeScript、読みにくい)、暗黙知
(ユーザーの頭の中) に散在している。

AgentBlueprint は、これらのルールを **1つの JSON Schema** に統合し、AI Builder
が正しい設定を書けるようにする。

## 価値提案

|                 | 現状                                        | AgentBlueprint                                |
| --------------- | ------------------------------------------- | --------------------------------------------- |
| ルールの所在    | docs + validator.ts + 暗黙知                | **1つの JSON Schema**                         |
| 設定ファイル数  | 3ファイル (agent.json + registry + schemas) | **1ファイル** (Blueprint) → split → 3ファイル |
| 整合性検証      | `--validate` (実行時)                       | **Schema validation** (記述時)                |
| AI の学習コスト | 3つの Schema + docs + 暗黙ルール            | **1つの Schema**                              |

## 言語ではないもの

- コード生成器ではない (AI が全フィールドを書く)
- プログラミング言語ではない (計算能力なし)
- 抽象化ツールではない (step をそのまま書く)
- Runner への変更ではない (出力は既存 JSON)

## ドキュメント構成

| ファイル                                       | 内容                                 |
| ---------------------------------------------- | ------------------------------------ |
| [00-overview.md](00-overview.md)               | 本ファイル                           |
| [01-structure.md](01-structure.md)             | Blueprint の構造と各セクションの定義 |
| [02-integrity-rules.md](02-integrity-rules.md) | 38の整合性ルール一覧                 |
| [03-constraints.md](03-constraints.md)         | 言語の制約 (やらないこと)            |
| [04-terminology.md](04-terminology.md)         | 用語辞書                             |
| [05-examples.md](05-examples.md)               | 実在エージェントの Blueprint 例      |
