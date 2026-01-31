# Climpt

[English](README.md) | [日本語](README.ja.md)

CLIプロンプト管理ツール。Iterator、Reviewerエージェントも含まれています。CLI以外にも、MCPやプラグインを通じて利用可能です。プラグインのスキルは専用のclimpt-agent（Claude Agent SDK経由）で実行されます。

## クイックスタート

```bash
# 設定を初期化
deno run -A jsr:@aidevtool/climpt init

# 最初のコマンドを実行
echo "ログインバグを修正" | deno run -A jsr:@aidevtool/climpt git decide-branch working-branch
```

📖 [詳細ドキュメント](https://tettuan.github.io/climpt/)

## Climptとは？

Climptは事前に設定されたプロンプトを整理し、1つのコマンドで呼び出します。3つの利用方法：

| 方法 | 説明 |
|------|------|
| **CLI** | コマンドラインから直接実行 |
| **MCP** | Model Context ProtocolでClaude/Cursorと連携 |
| **Plugin** | climpt-agentを使用したClaude Codeプラグイン |

### 詳細を知る

インタラクティブに探索：[Climpt NotebookLM](https://notebooklm.google.com/notebook/6a186ac9-70b2-4734-ad46-359e26043507)

## CLI使用方法

### コマンド構文

```bash
deno run -A jsr:@aidevtool/climpt <profile> <directive> <layer> [options]
```

**例：**
```bash
# 課題をタスクに分解
deno run -A jsr:@aidevtool/climpt breakdown to task --from=issue.md --adaptation=detailed

# 標準入力から生成
echo "エラーログ" | deno run -A jsr:@aidevtool/climpt diagnose trace stack -o=./output/
```

### 主要オプション

| オプション | 短縮形 | 説明 |
|------------|--------|------|
| `--from` | `-f` | 入力ファイル |
| `--destination` | `-o` | 出力パス |
| `--edition` | `-e` | プロンプトエディション |
| `--adaptation` | `-a` | プロンプトバリエーション |
| `--uv-*` | - | カスタム変数 |

📖 [CLI完全リファレンス](https://tettuan.github.io/climpt/)

## プロンプトテンプレート

プロンプトは `.agent/climpt/prompts/` に配置：

```
.agent/climpt/prompts/<profile>/<directive>/<layer>/f_<edition>_<adaptation>.md
```

**テンプレート変数：**
- `{input_text}` - 標準入力からのテキスト
- `{input_text_file}` - 入力ファイルパス
- `{destination_path}` - 出力パス
- `{uv-*}` - カスタム変数

📖 [プロンプトガイド](https://tettuan.github.io/climpt/)

## MCPサーバー

MCPでClaudeまたはCursorと連携：

```json
{
  "mcpServers": {
    "climpt": {
      "command": "deno",
      "args": ["run", "-A", "jsr:@aidevtool/climpt/mcp"]
    }
  }
}
```

📖 [MCP設定ガイド](https://tettuan.github.io/climpt/)

## Claude Codeプラグイン

```bash
# マーケットプレイスを追加
/plugin marketplace add tettuan/climpt

# インストール
/plugin install climpt-agent
```

機能：
- 自然言語によるコマンド実行
- Gitワークフロー（コミット、ブランチ、PR）
- プロンプト管理操作

## エージェント

**前提条件**: エージェントには GitHub CLI (`gh`) のインストールと認証、および GitHub にプッシュされた Git リポジトリが必要です。

### エージェント構成

各エージェントは `.agent/{agent-name}/` に以下の構成で定義されます：

```
.agent/{agent-name}/
├── agent.json          # エージェント設定
├── steps_registry.json # プロンプト用ステップ定義
└── prompts/            # プロンプトテンプレート
    └── system.md       # システムプロンプト
```

**agent.json** の主要プロパティ：
- `name`, `displayName`, `version` - エージェント識別情報
- `behavior.completionType` - 実行モード（後述）
- `behavior.allowedTools` - エージェントが利用可能なツール
- `prompts.registry` - ステップレジストリへのパス
- `logging.directory` - ログ出力先

**steps_registry.json** は各実行ステップのプロンプト選択ロジックを定義します。

### 新規エージェント作成

```bash
deno task agent --init --agent {agent-name}
```

テンプレートファイルを含むディレクトリ構成が生成されます。

### エージェント実行

```bash
# 利用可能なエージェントを一覧表示
deno task agent --list

# GitHub Issue を指定して実行
deno task agent --agent {name} --issue {number}

# GitHub Project を指定して実行
deno task agent --agent {name} --project {number}

# 反復モードで実行
deno task agent --agent {name} --iterate-max 10
```

### 完了タイプ

| タイプ | 説明 |
|--------|------|
| `issue` | GitHub Issue がクローズされたら完了 |
| `project` | GitHub Project から複数の Issue を処理 |
| `iterate` | 指定回数（`maxIterations`）反復実行 |
| `manual` | エージェントが `completionKeyword` を出力したら終了 |
| `custom` | カスタムハンドラー（`handlerPath`）を使用 |
| `facilitator` | プロジェクト状況を定期的に監視 |
| `stepFlow` | ステップベースの実行フローに従う |

### 組み込みエージェント

**Iterator Agent** - 自律開発：
```bash
deno run -A jsr:@aidevtool/climpt/agents/iterator --issue 123
```

**Reviewer Agent** - コードレビュー：
```bash
deno run -A jsr:@aidevtool/climpt/agents/reviewer --project 1
```

**Facilitator Agent** - プロジェクト監視：
```bash
deno run -A jsr:@aidevtool/climpt/agents/facilitator --project 1
```

### 設定例

最小限の `agent.json`：

```json
{
  "name": "my-agent",
  "displayName": "My Agent",
  "version": "1.0.0",
  "description": "カスタムエージェントの説明",
  "behavior": {
    "systemPromptPath": "prompts/system.md",
    "completionType": "issue",
    "completionConfig": {},
    "allowedTools": ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
    "permissionMode": "plan"
  },
  "parameters": {
    "issue": {
      "type": "number",
      "description": "GitHub Issue 番号",
      "required": true,
      "cli": "--issue"
    }
  },
  "prompts": {
    "registry": "steps_registry.json",
    "fallbackDir": "prompts/"
  },
  "logging": {
    "directory": "tmp/logs/agents/my-agent",
    "format": "jsonl"
  }
}
```

📖 [エージェントドキュメント](https://tettuan.github.io/climpt/)

## 設定

Climptは `.agent/climpt/config/` に2つの設定ファイルを使用：

- `<profile>-app.yml` - プロンプト/スキーマディレクトリ
- `<profile>-user.yml` - ユーザー設定

📖 [設定ガイド](https://tettuan.github.io/climpt/)

## ドキュメント

ドキュメントをmarkdownとしてローカルにインストール：

```bash
# 全ドキュメントをインストール
dx jsr:@aidevtool/climpt/docs

# 日本語ガイドのみインストール
dx jsr:@aidevtool/climpt/docs install ./docs --category=guides --lang=ja

# 1ファイルに結合
dx jsr:@aidevtool/climpt/docs install ./docs --mode=single

# 利用可能なドキュメント一覧
dx jsr:@aidevtool/climpt/docs list
```

📖 [オンラインドキュメント](https://tettuan.github.io/climpt/)

## 必要要件

- Deno 2.5以上
- インターネット接続（JSRパッケージ用）

## ライセンス

MITライセンス - [LICENSE](LICENSE) ファイルを参照。

## コントリビュート

Issue、PRは[GitHub](https://github.com/tettuan/climpt)で受け付けています。
