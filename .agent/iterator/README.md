# .agent/iterator

Iterator Agent のプロンプト外部化設定。

## 概要

Iterator Agent は GitHub Issue や Project を自動処理するエージェント。プロンプトは `.agent/iterator/prompts/` に外部化され、カスタマイズ可能。

## 設計意図

### iterator agent から見た視点

1. **climpt 標準機能の活用**: `agents/iterator` が独自のプロンプト実行を持たず、climpt の標準機能から呼び出す
2. **独立した定義**: climpt 本体と混在しないよう、iterator 専用の agent 定義を分離
3. **値置換の委譲**: 独自の変数置換を実装せず、climpt (breakdown) の uv- システムを利用

### climpt から見た視点

- `climpt-<c1> <c2> <c3>` とは分離した `iterator-<c1> <c2> <c3>` として、C3L の体系に基づいて設計

## ディレクトリ構成

```
.agent/iterator/
├── README.md              # このファイル
├── agent.json             # エージェント設定
├── config.json            # ランタイム設定
├── registry.json          # C3L コマンド登録情報
├── steps_registry.json    # ステップ定義 (プロンプト解決用)
├── frontmatter-to-schema/ # スキーマ生成テンプレート
└── prompts/
    ├── system.md          # システムプロンプト
    ├── dev/               # 開発用プロンプト
    │   ├── start/project/ # --mode project
    │   ├── start/issue/   # --mode issue
    │   └── start/default/ # --mode iterate
    └── steps/             # ステップ別プロンプト
        ├── initial/       # 初期フェーズ
        │   ├── issue/     # Issue モード
        │   └── project/   # Project モード
        ├── continuation/  # 継続フェーズ
        │   ├── issue/
        │   ├── project/
        │   └── iterate/
        └── section/       # セクション
            └── project/   # プロジェクトコンテキスト
```

## ステップ一覧

### Issue モード

| Step ID | ファイル | 説明 |
|---------|----------|------|
| `initial.issue` | `steps/initial/issue/f_default.md` | Issue 処理開始 |
| `continuation.issue` | `steps/continuation/issue/f_default.md` | Issue 継続処理 |

### Project モード

| Step ID | ファイル | 説明 |
|---------|----------|------|
| `initial.project.preparation` | `steps/initial/project/f_preparation.md` | 準備フェーズ |
| `initial.project.preparationempty` | `steps/initial/project/f_preparation_empty.md` | Issue なし時 |
| `initial.project.review` | `steps/initial/project/f_review.md` | レビューフェーズ |
| `initial.project.complete` | `steps/initial/project/f_complete.md` | 完了メッセージ |
| `section.projectcontext` | `steps/section/project/f_context.md` | コンテキスト挿入 |

### Iterate モード

| Step ID | ファイル | 説明 |
|---------|----------|------|
| `initial.iterate` | `steps/initial/iterate/f_default.md` | イテレーション開始 |
| `continuation.iterate` | `steps/continuation/iterate/f_default.md` | イテレーション継続 |

## 変数置換

プロンプトは breakdown の uv- システムで変数展開:

### UV 変数

| 変数 | モード | 用途 |
|-----|--------|------|
| `{uv-issue_number}` | Issue | GitHub Issue 番号 |
| `{uv-project_number}` | Project | GitHub Project 番号 |
| `{uv-project_title}` | Project | プロジェクト名 |
| `{uv-label_info}` | Project | ラベル情報 |
| `{uv-label_filter}` | Project | ラベルフィルタ |
| `{uv-total_issues}` | Project | Issue 総数 |
| `{uv-current_index}` | Project | 現在の Issue インデックス |
| `{uv-issues_completed}` | Project | 完了 Issue 数 |
| `{uv-completed_iterations}` | All | 完了イテレーション数 |
| `{uv-iterations}` | Iterate | 目標イテレーション数 |
| `{uv-remaining}` | Iterate | 残りイテレーション数 |

### カスタム変数

| 変数 | 用途 |
|-----|------|
| `{project_context_section}` | プロジェクトコンテキスト挿入 |
| `{issue_content}` | GitHub Issue 本文 |
| `{cross_repo_note}` | クロスリポジトリ注意書き |

### STDIN 入力

| 変数 | 用途 |
|-----|------|
| `{input_text}` | STDIN からの入力テキスト |

## カスタマイズ

プロンプトをカスタマイズするには:

1. 対象のステップを `steps_registry.json` で確認
2. 対応するパスにファイルを作成/編集
3. UV 変数を使用して動的コンテンツを挿入

例: Issue 初期プロンプトのカスタマイズ

```markdown
---
stepId: initial.issue
name: Custom Issue Prompt
---

## Issue #{uv-issue_number} の処理

{issue_content}

### 私のワークフロー

1. 要件を分析
2. TodoWrite でタスク分解
3. 順次実装
```

## 参照

- プロンプトカスタマイズ: [docs/prompt-customization-guide.md](../../docs/prompt-customization-guide.md)
- アーキテクチャ: [docs/internal/prompt-architecture.md](../../docs/internal/prompt-architecture.md)
- Iterator 設計: [docs/internal/iterate-agent-design.md](../../docs/internal/iterate-agent-design.md)
- C3L 統合: [docs/internal/iterate-agent-c3l-integration.md](../../docs/internal/iterate-agent-c3l-integration.md)
