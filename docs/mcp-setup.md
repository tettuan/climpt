# Climpt MCP Server セットアップガイド

## 概要
Climpt MCP ServerはClaude Codeのslashコマンドから`climpt`の機能を利用できるようにするMCP (Model Context Protocol) サーバーです。

## 利用可能なコマンド

### `search`
英語のクエリを送信すると、説明が最も近いコマンドを3つ返します。

**引数:**
- `query` (必須): コマンドを検索するための英語の説明文

**動作:**
- registry.jsonから`c1 + c2 + c3 + description`の文字列を対象に類似度計算を実行
- コサイン類似度に基づいて上位3つのコマンドを返却
- 返却値には各コマンドの`c1`, `c2`, `c3`, `description`を含む

**使用例:**
```json
{
  "query": "commit changes to git repository"
}
```

### `describe`
コマンドの詳細情報を取得します。

**引数:**
- `c1` (必須): ドメイン名（例: git, spec, test）
- `c2` (必須): アクション名（例: create, analyze）
- `c3` (必須): ターゲット名（例: refinement-issue, quality-metrics）

**動作:**
- 指定された`c1`, `c2`, `c3`に一致するregistry.jsonの全レコードを返却
- 同じc1,c2,c3でオプションが異なる複数のレコードが存在する場合、全て返却
- JSON構造を完全に維持して返却

**使用例:**
```json
{
  "c1": "git",
  "c2": "group-commit",
  "c3": "unstaged-changes"
}
```

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
2. 以下のツールを試す：
   - `search` - コマンド検索（類似度ベース）
   - `describe` - コマンド詳細取得

## ツール機能

MCPサーバーは以下のツールを提供します：

### `search` ツール
```javascript
// 使用例: コマンド検索
{
  "tool": "search",
  "arguments": {
    "query": "commit changes to git repository"
  }
}

// 返却例
{
  "results": [
    {
      "c1": "git",
      "c2": "group-commit",
      "c3": "unstaged-changes",
      "description": "Create a group commit for unstaged changes",
      "score": 0.338
    }
  ]
}
```

### `describe` ツール
```javascript
// 使用例: コマンド詳細取得
{
  "tool": "describe",
  "arguments": {
    "c1": "git",
    "c2": "group-commit",
    "c3": "unstaged-changes"
  }
}

// 返却例: registry.jsonの該当レコード全体
{
  "commands": [
    {
      "c1": "git",
      "c2": "group-commit",
      "c3": "unstaged-changes",
      "description": "Create a group commit for unstaged changes",
      "usage": "...",
      "options": { ... }
    }
  ]
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