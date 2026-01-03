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

### Iterator Agent

Claude Agent SDKを使用した自律開発システム：

```bash
# 最初に初期化（必須）
deno run -A jsr:@aidevtool/climpt/agents/iterator --init

# その後 issue を指定して実行
deno run -A jsr:@aidevtool/climpt/agents/iterator --issue 123
```

### Reviewer Agent

自律的なコードレビューエージェント：

```bash
deno run -A jsr:@aidevtool/climpt/agents/reviewer --pr 456
```

📖 [エージェントドキュメント](https://tettuan.github.io/climpt/)

## 設定

Climptは `.agent/climpt/config/` に2つの設定ファイルを使用：

- `<profile>-app.yml` - プロンプト/スキーマディレクトリ
- `<profile>-user.yml` - ユーザー設定

📖 [設定ガイド](https://tettuan.github.io/climpt/)

## 必要要件

- Deno 2.5以上
- インターネット接続（JSRパッケージ用）

## ライセンス

MITライセンス - [LICENSE](LICENSE) ファイルを参照。

## コントリビュート

Issue、PRは[GitHub](https://github.com/tettuan/climpt)で受け付けています。
