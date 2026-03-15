# 3. Constraints

AgentBlueprint がやらないことの定義。

## 原則

> AgentBlueprint
> は「正しさを保証する」言語であり、「書く量を減らす」言語ではない。

## 制約一覧

### C1. 計算能力なし

ループ、条件分岐、変数参照、式評価、文字列結合はない。全ての値はリテラルである。JSON
であるため、構造的に不可能。

### C2. 推論・自動補完なし

Blueprint に書かれていないフィールドを推論で補完することはない。AI
が全フィールドを明示的に書く。

省略されたフィールドは、既存の agent.schema.json / steps_registry.schema.json
のデフォルト値規則に従う (Blueprint が独自のデフォルトを追加することはない)。

### C3. 新しい語彙を発明しない

Blueprint のフィールド名は Runtime (agent.json, steps_registry.json)
と同一である。

- `stepKind` であり `kind` ではない
- `allowedIntents` であり `intents` ではない
- `uvVariables` であり `receives` ではない
- `successWhen` であり `expect` ではない

理由: AI は既存の agent.json と steps_registry.json
を読んだことがある。同じ語彙を使うことで、学習コストをゼロにする。

### C4. Runner を変更しない

Blueprint は既存の Runner が消費する JSON を生成する。

- 新しい verdict type は作れない (8つの固定 enum)
- 新しい intent は作れない (7つの固定 enum)
- 新しいフィールドは追加できない

### C5. 単一 Agent 定義

1つの Blueprint ファイルは1つの Agent を定義する。 import, include, 継承,
ミックスインはない。

### C6. プロンプト内容を含まない

Blueprint は prompts/
のディレクトリパスとファイル参照のみを持つ。プロンプトのテキスト内容は含まない。

### C7. エスケープハッチなし

raw, passthrough, 任意 JSON バイパスの仕組みはない。Blueprint
で表現できないものは、分割後の個別ファイルで手動追加する。

### C8. Blueprint 固有の構文なし

`agent` セクションは agent.json そのまま、`registry` セクションは
steps_registry.json そのまま、`schemas` セクションは既存の JSON Schema
そのまま。Blueprint 固有の記法や省略記法はない。

**Blueprint が追加するのは「3つを1つにまとめる」ことと「整合性ルール」のみ。**
