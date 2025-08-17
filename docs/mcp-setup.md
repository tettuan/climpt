# Climpt MCP Server セットアップガイド

## 概要
Climpt MCP ServerはClaude Codeのslashコマンドから`climpt`の機能を利用できるようにするMCP (Model Context Protocol) サーバーです。

## 利用可能なコマンド

### `/climpt:project`
プロジェクト要件をGitHub Issuesに分解します。

**引数:**
- `input` (必須): プロジェクトの要件説明
- `outputFormat` (オプション): 出力形式 (markdown | json | yaml)

### `/climpt:summary`
タスクや情報を要約します。

**引数:**
- `input` (必須): 要約したい内容
- `type` (オプション): 要約タイプ (task | document | log)

### `/climpt:defect`
エラーログから修正タスクを生成します。

**引数:**
- `input` (必須): エラーログや不具合報告
- `priority` (オプション): 優先度 (low | medium | high | critical)

## セットアップ手順

### 1. リポジトリのクローン
```bash
git clone https://github.com/tettuan/climpt.git
cd climpt
```

### 2. Claude Codeの設定

Claude Codeの設定ファイル（`~/.claude/claude_settings.json`）に以下を追加：

```json
{
  "mcpServers": {
    "climpt": {
      "command": "deno",
      "args": [
        "run",
        "--allow-read",
        "--allow-write",
        "--allow-net",
        "--allow-env",
        "/path/to/climpt/src/mcp/index.ts"
      ]
    }
  }
}
```

**注意:** `/path/to/climpt` を実際のclimptリポジトリのパスに置き換えてください。

### 3. 動作確認

1. Claude Codeを再起動
2. 以下のコマンドを試す：
   - `/climpt:project` - プロジェクト分解
   - `/climpt:summary` - 要約生成
   - `/climpt:defect` - エラー分析

## ツール機能

MCPサーバーは`breakdown`ツールも提供しており、プログラム的にclimptの機能を呼び出すことができます。

```javascript
// ツールの使用例
{
  "tool": "breakdown",
  "arguments": {
    "command": "project",
    "input": "ECサイトを作りたい",
    "options": {
      "outputFormat": "markdown"
    }
  }
}
```

## トラブルシューティング

### サーバーが起動しない場合
- Denoがインストールされているか確認: `deno --version`
- パスが正しいか確認
- 権限フラグが適切か確認

### コマンドが認識されない場合
- Claude Codeを再起動
- 設定ファイルのJSON構文を確認
- MCPサーバー名が`climpt`になっているか確認

## 開発者向け情報

### ローカルでのテスト
```bash
# MCPサーバーを直接起動してテスト
deno run --allow-read --allow-write --allow-net --allow-env src/mcp/index.ts
```

### デバッグ
環境変数`DEBUG=mcp*`を設定することで詳細なログを確認できます。

## 参考リンク
- [MCP SDK for TypeScript](https://jsr.io/@modelcontextprotocol/sdk)
- [Climpt Repository](https://github.com/tettuan/climpt)
- [Breakdown Package](https://jsr.io/@tettuan/breakdown)