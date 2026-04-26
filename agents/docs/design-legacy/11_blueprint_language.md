# Blueprint Language

Agent Runner 設定の cross-file integrity を形式化する言語。

## 問題

Agent Runner の設定は 3 ファイル (agent.json, steps_registry.json, schemas/)
に分散し、52 の相互参照ルールで結ばれている。これらのルールは docs
(揺れる)、validator.ts (読みにくい)、暗黙知 (共有できない) に散在していた。

## 解決策

**AgentBlueprint**: 3 ファイルの内容を 1 つの JSON に統合し、JSON Schema で
cross-file integrity を検証する。

```
Blueprint JSON (1 file)
  ├── agent section    → split → agent.json
  ├── registry section → split → steps_registry.json
  └── schemas section  → split → schemas/*.schema.json
```

## 設計判断

### 価値提案: 整合性保証 (not 自動生成)

v1 では「phase を書けば step
が自動生成される」という抽象化を試みたが、実在エージェント (iterator/reviewer)
の step graph が多様すぎて抽象が破綻した。

v2 では「step をそのまま書く。ただし cross-file の参照整合性を Schema
が保証する」に転換した。

### Runtime 語彙の直接使用

Blueprint 固有の用語は 3 つのみ (Blueprint, Splitter, Integrity
Rule)。残りは全て Runtime 語彙 (stepId, c2, c3, structuredGate 等)
をそのまま使う。

### ベンチマーク言語

- **CUE**: cross-file 制約の概念モデル (unification)
- **Statecharts**: 意味モデル (phases, intents, guards)
- **Protobuf**: 1 source → N artifacts のコンパイルパターン

## 参照

- 仕様: `agents/docs/builder/reference/blueprint/`
- Schema: `agents/schemas/agent-blueprint.schema.json`
- 既存 Schema: `agents/schemas/agent.schema.json`,
  `agents/schemas/steps_registry.schema.json`
