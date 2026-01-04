[English](../en/04-iterate-agent-setup.md) | [日本語](../ja/04-iterate-agent-setup.md)

# 4. Iterate Agent の設定と実行

GitHub Issue や Project を自動的に処理する Iterate Agent を設定し、実行します。

## 目次

1. [Iterate Agent とは](#41-iterate-agent-とは)
2. [前提条件](#42-前提条件)
3. [初期化](#43-初期化)
4. [基本的な使い方](#44-基本的な使い方)
5. [完了条件](#45-完了条件)
6. [設定のカスタマイズ](#46-設定のカスタマイズ)
7. [実行レポート](#47-実行レポート)
8. [トラブルシューティング](#48-トラブルシューティング)

---

## 4.1 Iterate Agent とは

Iterate Agent は Claude Agent SDK を使用した自律型開発エージェントです。
以下のサイクルを自動的に繰り返します：

```
┌─────────────────────────────────────────────────────────────┐
│                    Iterate Agent の動作                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. GitHub Issue/Project から要件を取得                     │
│                    ↓                                        │
│  2. delegate-climpt-agent Skill でタスクを実行             │
│                    ↓                                        │
│  3. サブエージェントが開発作業を実施                        │
│                    ↓                                        │
│  4. 結果を評価し、完了条件をチェック                        │
│                    ↓                                        │
│  5. 未完了 → 次のタスクを決定して 2 へ戻る                  │
│     完了   → 終了                                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 主な特徴

- **自律実行**: 人間の介入なしに動作
- **GitHub 統合**: `gh` CLI を通じて Issue/Project と連携
- **Climpt Skills 統合**: 既存の Climpt インフラストラクチャを活用
- **詳細ログ**: JSONL 形式、自動ローテーション（最大100ファイル）
- **柔軟な完了条件**: Issue クローズ、Project 完了、イテレーション数

---

## 4.2 前提条件

**重要**: Iterate Agent を使用する前に、以下のセットアップが必要です：

### 必須要件

| 要件 | 説明 | 確認方法 |
|------|------|----------|
| **GitHub CLI (`gh`)** | インストールと認証が必要 | `gh auth status` |
| **Git リポジトリ** | プロジェクトが Git リポジトリであること | `git status` |
| **GitHub リモート** | リポジトリが GitHub にプッシュされていること | `git remote -v` |
| **対象 Issue/Project** | GitHub 上に存在すること | `gh issue list` |
| **Claude Code Plugin** | climpt-agent プラグインがインストール済み | `.claude/settings.json` を確認 |

### Claude Code プラグインのセットアップ

`delegate-climpt-agent` Skill を使用するには、climpt-agent プラグインが必要です：

```bash
# Claude Code で以下のスラッシュコマンドを実行：
/plugin marketplace add tettuan/climpt
/plugin install climpt-agent
```

インストール後、`.claude/settings.json` に以下が追加されます：

```json
{
  "plugins": {
    "marketplace": ["tettuan/climpt"],
    "installed": ["climpt-agent"]
  }
}
```

> **注意**: プラグインがインストールされていない場合、エージェントは警告を表示しますが、制限された機能で動作を続けます。

### GitHub CLI のセットアップ

```bash
# インストール (macOS)
brew install gh

# インストール (その他のプラットフォーム)
# 参照: https://cli.github.com/manual/installation

# 認証
gh auth login
```

### セットアップの確認

```bash
# gh の認証確認
gh auth status

# git リポジトリ確認
git status

# GitHub リモート確認
git remote -v

# 利用可能な Issue 一覧
gh issue list
```

### 初期化は必須

Iterate Agent を実行する前に、**必ず**初期化コマンドを実行してください：

```bash
deno run -A jsr:@aidevtool/climpt/agents/iterator --init
```

これにより必要な設定ファイルが作成されます。詳細は[初期化](#43-初期化)を参照してください。

---

## 4.3 初期化

### プロジェクトディレクトリへ移動

```bash
cd your-project
```

### 初期化コマンドの実行

```bash
deno run -A jsr:@aidevtool/climpt/agents/iterator --init
```

出力例：
```
Iterate Agent initialized successfully!

Created files:
  - agents/iterator/config.json
  - .agent/iterator/prompts/dev/*

Next steps:
  1. Review and customize the configuration in agents/iterator/config.json
  2. Install the Claude Code plugin (required for delegate-climpt-agent Skill):
     /plugin marketplace add tettuan/climpt
     /plugin install climpt-agent
  3. Run: deno run -A jsr:@aidevtool/climpt/agents/iterator --issue <number>

Note: Requires 'gh' CLI (https://cli.github.com) with authentication.
```

### 作成されるファイル

```
your-project/
├── agents/iterator/
│   └── config.json           # メイン設定
├── .agent/iterator/
│   └── prompts/dev/          # システムプロンプト（C3L形式）
└── tmp/
    └── logs/
        └── agents/           # 実行ログ（自動作成）
```

---

## 4.4 基本的な使い方

### Issue ベースの実行

指定した Issue がクローズされるまで自動実行：

```bash
deno run -A jsr:@aidevtool/climpt/agents/iterator --issue 123
```

短縮形：
```bash
deno run -A jsr:@aidevtool/climpt/agents/iterator -i 123
```

### Project ベースの実行

Project 内のすべてのアイテムが完了するまで実行：

```bash
deno run -A jsr:@aidevtool/climpt/agents/iterator --project 5
```

短縮形：
```bash
deno run -A jsr:@aidevtool/climpt/agents/iterator -p 5
```

### イテレーション数を制限

最大10回のイテレーションで停止：

```bash
deno run -A jsr:@aidevtool/climpt/agents/iterator --iterate-max 10
```

短縮形：
```bash
deno run -A jsr:@aidevtool/climpt/agents/iterator -m 10
```

### セッションの再開

前回のセッションを継続：

```bash
deno run -A jsr:@aidevtool/climpt/agents/iterator --issue 123 --resume
```

### オプション一覧

| オプション | 短縮形 | デフォルト | 説明 |
|-----------|--------|-----------|------|
| `--init` | - | - | 設定ファイルを初期化 |
| `--issue` | `-i` | - | 対象の GitHub Issue 番号 |
| `--project` | `-p` | - | 対象の GitHub Project 番号 |
| `--iterate-max` | `-m` | Infinity | 最大イテレーション数 |
| `--name` | `-n` | `climpt` | エージェント名 |
| `--project-owner` | `-o` | リポジトリ所有者 | プロジェクト所有者（--project 使用時のみ） |
| `--resume` | `-r` | false | 前回セッションを再開 |
| `--help` | `-h` | - | ヘルプを表示 |

---

## 4.5 完了条件

| モード | 完了条件 | チェック方法 |
|--------|---------|-------------|
| `--issue` | Issue がクローズ | `gh issue view --json state` |
| `--project` | 全アイテムが完了 | `gh project view --format json` |
| `--iterate-max` | 指定回数に到達 | 内部カウンター |

### 組み合わせ

複数の条件を組み合わせることも可能：

```bash
# Issue #123 がクローズされるか、10回のイテレーションで停止
deno run -A jsr:@aidevtool/climpt/agents/iterator --issue 123 --iterate-max 10

# 別のユーザー/組織が所有するプロジェクトで作業
deno run -A jsr:@aidevtool/climpt/agents/iterator --project 5 --project-owner my-org
```

### --project-owner について

プロジェクト番号はプロジェクト所有者ごとに独立しています。
デフォルトではリポジトリ所有者のプロジェクトを参照しますが、
`--project-owner` で明示的に指定することで異なる所有者のプロジェクトを操作できます：

```bash
# 自分のプロジェクト（@me = 認証ユーザー）
deno run -A jsr:@aidevtool/climpt/agents/iterator --project 5 --project-owner @me

# 組織のプロジェクト
deno run -A jsr:@aidevtool/climpt/agents/iterator --project 5 --project-owner my-org

# 他のユーザーのプロジェクト（アクセス権限が必要）
deno run -A jsr:@aidevtool/climpt/agents/iterator --project 5 --project-owner tettuan
```

---

## 4.6 設定のカスタマイズ

### config.json

```json
{
  "version": "1.0.0",
  "agents": {
    "climpt": {
      "allowedTools": [
        "Skill",
        "Read",
        "Write",
        "Edit",
        "Bash",
        "Glob",
        "Grep"
      ],
      "permissionMode": "acceptEdits"
    }
  },
  "github": {
    "apiVersion": "2022-11-28"
  },
  "logging": {
    "directory": "tmp/logs/agents",
    "maxFiles": 100,
    "format": "jsonl"
  }
}
```

### 設定項目の説明

| 項目 | 説明 |
|------|------|
| `allowedTools` | 使用可能なツールのリスト |
| `permissionMode` | 権限モード |
| `logging.directory` | ログ出力先 |
| `logging.maxFiles` | ログファイル最大数（ローテーション） |

### permissionMode の種類

| モード | 説明 | 推奨用途 |
|--------|------|---------|
| `default` | すべての操作に確認が必要 | 初回テスト |
| `plan` | プランニングのみ許可 | 計画確認 |
| `acceptEdits` | ファイル編集を自動承認 | **通常運用（推奨）** |
| `bypassPermissions` | すべての操作を自動承認 | 完全自動化 |

### システムプロンプトのカスタマイズ

システムプロンプトは `.agent/iterator/prompts/dev/` にC3L形式で配置されています：

| ファイル | 用途 |
|---------|------|
| `start/default/f_default.md` | イテレーション回数ベースモード |
| `start/issue/f_default.md` | 単一GitHub Issueモード |
| `start/project/f_default.md` | GitHub Project準備モード |
| `review/project/f_default.md` | プロジェクト完了レビューモード |

これらのプロンプトはUV変数を使用して動的にコンテンツを挿入します（例：`{uv-agent_name}`, `{uv-completion_criteria}`）。

### --agent オプションについて

`--agent` は `registry_config.json` で定義されたレジストリ名を指定します：

```json
// .agent/climpt/config/registry_config.json
{
  "registries": {
    "climpt": ".agent/climpt/registry.json",
    "iterator": ".agent/iterator/registry.json"
  }
}
```

| --agent 値 | 使用されるレジストリ |
|-----------|---------------------|
| `climpt` | `.agent/climpt/registry.json` |
| `iterator` | `.agent/iterator/registry.json` |

---

## 4.7 実行レポート

実行完了時に、詳細なレポートが表示されます：

```
📊 Execution Report
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⏱️  Performance
  | 指標           | 値             |
  |----------------|----------------|
  | 総実行時間     | 328秒 (~5.5分) |
  | API時間        | 241秒 (~4分)   |
  | ターン数       | 28             |
  | イテレーション | 1回            |
  | 総コスト       | $0.82 USD      |

📈 Token Usage
  | モデル           | Input  | Output | キャッシュ読込 | コスト |
  |------------------|--------|--------|----------------|--------|
  | claude-opus-4-5  | 3,120  | 6,000  | 663,775        | $0.79  |
  | claude-haiku-4-5 | 32,380 | 656    | 0              | $0.04  |

📋 Activity
  | 指標           | 値  |
  |----------------|-----|
  | ログエントリ   | 142 |
  | エラー         | 2   |
  | Issue更新      | 3   |
  | Project更新    | 1   |
  | 完了理由       | ✅ criteria_met |

🛠️  Tools Used
  - Edit: 12
  - Bash: 8
  - Read: 25
  - Grep: 15
```

### ログファイル

ログは JSONL 形式で保存されます：

```
tmp/logs/agents/climpt/session-2025-12-31T10-00-00-000Z.jsonl
```

ログの確認：

```bash
# 最新のログを表示
cat tmp/logs/agents/climpt/session-*.jsonl | jq .

# エラーのみ抽出
cat tmp/logs/agents/climpt/session-*.jsonl | jq 'select(.level == "error")'

# アシスタントの応答のみ
cat tmp/logs/agents/climpt/session-*.jsonl | jq 'select(.level == "assistant")'
```

---

## 4.8 トラブルシューティング

### gh command not found

GitHub CLI がインストールされていません：

```bash
# macOS
brew install gh

# 認証
gh auth login
```

→ [01-prerequisites.md](./01-prerequisites.md) を参照

### Configuration file not found

プロジェクトルートから実行してください：

```bash
cd your-project
deno run -A jsr:@aidevtool/climpt/agents/iterator --init
```

### Empty output from breakdown CLI

プロンプトテンプレートが存在することを確認：

```bash
ls -la .agent/iterator/prompts/dev/
```

存在しない場合は `--init` を再実行：

```bash
deno run -A jsr:@aidevtool/climpt/agents/iterator --init
```

### Permission denied エラー

`config.json` の `permissionMode` を確認：

```json
{
  "agents": {
    "climpt": {
      "permissionMode": "acceptEdits"
    }
  }
}
```

### gh auth status fails

GitHub CLI で再認証：

```bash
gh auth logout
gh auth login
```

### Project が見つからない

Project 番号と所有者を確認：

```bash
# プロジェクト一覧を表示
gh project list --owner @me
```

### Issue が見つからない

Issue 番号を確認：

```bash
# Issue 一覧を表示
gh issue list
```

---

## Deno Task として登録（推奨）

頻繁に使用する場合は、`deno.json` にタスクを追加：

```json
{
  "tasks": {
    "iterate-agent": "deno run -A jsr:@aidevtool/climpt/agents/iterator"
  }
}
```

実行：

```bash
deno task iterate-agent --issue 123
deno task iterate-agent --project 5 --iterate-max 10
```

---

## 次のステップ

- 実際の Issue で Iterate Agent を試す
- システムプロンプトをプロジェクトに合わせてカスタマイズ
- カスタム指示書を作成して Climpt Skills を拡張

## 関連ドキュメント

- [Iterate Agent 詳細リファレンス](../../agents/iterator/README.md)
- [設計ドキュメント](../../docs/internal/iterate-agent-design.md)
- [Climpt Skills リファレンス](../reference/skills/overview.md)

---

## サポート

問題が発生した場合は、Issue を作成してください：
https://github.com/tettuan/climpt/issues
