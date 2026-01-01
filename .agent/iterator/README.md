# .agent/iterator

## 設計意図

### iterator agent から見た視点

1. **climpt 標準機能の活用**: `agents/iterator` が独自のプロンプト実行を持たず、climpt の標準機能から呼び出す
2. **独立した定義**: climpt 本体と混在しないよう、iterator 専用の agent 定義を分離
3. **値置換の委譲**: 独自の変数置換を実装せず、climpt (breakdown) の uv- システムを利用

### climpt から見た視点

- `climpt-<c1> <c2> <c3>` とは分離した `iterator-<c1> <c2> <c3>` として、C3L の体系に基づいて設計

## 利用元

- `agents/iterator/` から呼び出し
- breakdown CLI profile: `iterator-dev`

## 構成

```
.agent/iterator/
├── prompts/dev/start/    # システムプロンプト
│   ├── project/          # --mode project
│   ├── issue/            # --mode issue
│   └── default/          # --mode iterate
├── registry.json         # C3L 登録情報
└── frontmatter-to-schema/ # スキーマ生成テンプレート
```

## 変数置換

プロンプトは breakdown の uv- システムで変数展開:

| 変数 | 用途 |
|-----|------|
| `{uv-agent_name}` | delegate 先エージェント名 |
| `{uv-completion_criteria}` | 完了条件 |
| `{uv-target_label}` | ラベルフィルタ |
| `{input_text}` | 完了条件詳細 (STDIN) |

## 参照

- 設計: `tmp/design-iterator-label-parameter.md`
- 実装: `iterate-agent/scripts/config.ts`
