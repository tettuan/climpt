# .agent/reviewer

Reviewer Agent のプロンプト外部化設定。

## 概要

Reviewer Agent はコードレビューやプロジェクトレビューを自動化するエージェント。プロンプトは `.agent/reviewer/prompts/` に外部化され、カスタマイズ可能。

## 設計意図

1. **climpt 標準機能の活用**: プロンプト解決に climpt (breakdown) の標準機能を利用
2. **独立した定義**: climpt 本体と混在しないよう、reviewer 専用の agent 定義を分離
3. **値置換の委譲**: 独自の変数置換を実装せず、uv- システムを利用

## ディレクトリ構成

```
.agent/reviewer/
├── README.md              # このファイル
├── agent.json             # エージェント設定
├── config.json            # ランタイム設定
├── registry.json          # C3L コマンド登録情報
├── steps_registry.json    # ステップ定義 (プロンプト解決用)
└── prompts/
    ├── system.md          # システムプロンプト
    ├── dev/               # 開発用プロンプト
    │   └── start/default/ # デフォルトモード
    └── steps/             # ステップ別プロンプト
        ├── initial/       # 初期フェーズ
        │   └── default/   # デフォルトモード
        └── continuation/  # 継続フェーズ
            └── default/
```

## ステップ一覧

| Step ID | ファイル | 説明 |
|---------|----------|------|
| `initial.default` | `steps/initial/default/f_default.md` | レビュー開始 |
| `continuation.default` | `steps/continuation/default/f_default.md` | レビュー継続 |

## 変数置換

プロンプトは breakdown の uv- システムで変数展開:

### UV 変数

| 変数 | 用途 |
|-----|------|
| `{uv-project}` | プロジェクト識別子 |
| `{uv-requirements_label}` | 要件ラベル |
| `{uv-review_label}` | レビューラベル |
| `{uv-iteration}` | 現在のイテレーション番号 |

## カスタマイズ

プロンプトをカスタマイズするには:

1. 対象のステップを `steps_registry.json` で確認
2. 対応するパスにファイルを作成/編集
3. UV 変数を使用して動的コンテンツを挿入

例: レビュー初期プロンプトのカスタマイズ

```markdown
---
stepId: initial.default
name: Custom Review Prompt
---

# コードレビューセッション

プロジェクト: {uv-project}

## レビューチェックリスト

1. コードスタイルとフォーマット確認
2. テストカバレッジ検証
3. ドキュメント確認
4. パフォーマンス影響評価

## レポート形式

issue-action ブロックで結果を報告してください。
```

## 参照

- プロンプトカスタマイズ: [docs/prompt-customization-guide.md](../../docs/prompt-customization-guide.md)
- アーキテクチャ: [docs/internal/prompt-architecture.md](../../docs/internal/prompt-architecture.md)
