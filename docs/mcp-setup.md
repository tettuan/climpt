# Climpt MCP Server セットアップガイド

## 概要
Climpt MCP ServerはClaude Codeのslashコマンドから`climpt`の機能を利用できるようにするMCP (Model Context Protocol) サーバーです。

## 利用可能なコマンド

### `search`
実行したいコマンドを簡潔に説明して渡すと、コサイン類似度で説明文から近いコマンドを3つ返します。受け取った結果から最適なコマンドを選べます。

**引数:**
- `query` (必須): 実行したいことの簡潔な説明（例: 'commit changes to git', 'generate API documentation', 'run tests'）

**動作:**
- registry.jsonから`c1 + c2 + c3 + description`の文字列を対象にコサイン類似度を計算
- 類似度上位3つのコマンドを返却
- 返却値には各コマンドの`c1`, `c2`, `c3`, `description`, `score`を含む

**使用例:**
```json
{
  "query": "commit changes to git repository"
}
```

### `describe`
searchで受け取った`c1`, `c2`, `c3`を渡すと、一致するコマンドの説明文を全て返します。その中から最適な使用法やオプションの組み合わせを知ることができ、オプションの使い方も選べます。

**引数:**
- `c1` (必須): searchから得たドメイン識別子（例: git, spec, test, code, docs, meta）
- `c2` (必須): searchから得たアクション識別子（例: create, analyze, execute, generate）
- `c3` (必須): searchから得たターゲット識別子（例: unstaged-changes, quality-metrics, unit-tests）

**動作:**
- 指定された`c1`, `c2`, `c3`に一致するregistry.jsonの全レコードを返却
- 同じc1,c2,c3でオプションが異なる複数のレコードが存在する場合、全て返却
- 使用方法、利用可能なオプション、ファイル/標準入力/出力先サポートを含む完全なJSON構造を返却

**使用例:**
```json
{
  "c1": "git",
  "c2": "group-commit",
  "c3": "unstaged-changes"
}
```

### `execute`
describeで得られた詳細情報をもとに、`<agent-name>`, `<c1>`, `<c2>`, `<c3>` の4つを必ず渡し、かつ、describeから得られたオプション引数（`-*`/`--*` 形式）も含めて実行します。オプションに渡す値も作成してから execute へ渡してください。execute の結果は指示書であるため、得られた指示に従って進めてください。

**注意:** STDINサポートが必要な場合は、MCPではなくCLIから直接climptコマンドを実行してください。

**引数:**
- `agent` (必須): C3L仕様のエージェント名（例: 'climpt', 'inspector', 'auditor'）。Agent-Domainモデルにおけるエージェント（自律実行者）に対応
- `c1` (必須): describeから得たドメイン識別子（例: git, spec, test, code, docs, meta）
- `c2` (必須): describeから得たアクション識別子（例: create, analyze, execute, generate）
- `c3` (必須): describeから得たターゲット識別子（例: unstaged-changes, quality-metrics, unit-tests）
- `options` (オプション): describeから得たコマンドラインオプションの配列（例: `['-f=file.txt']`）

**動作:**
- C3L v0.5 仕様に従い `--config` パラメータを構築: `agent === "climpt"` の場合は `--config=<c1>`、それ以外は `--config=<agent>-<c1>`
- `deno run jsr:@aidevtool/climpt --config=... <c2> <c3> [options]` を実行
- stdout, stderr, 終了コードを含む実行結果を返却
- 実行結果には指示内容が含まれており、その指示に従って次の作業を進める

**使用例（基本）:**
```json
{
  "agent": "climpt",
  "c1": "git",
  "c2": "group-commit",
  "c3": "unstaged-changes"
}
```

実行されるコマンド:
```bash
deno run --allow-read --allow-write --allow-env --allow-run --allow-net --no-config jsr:@aidevtool/climpt --config=git group-commit unstaged-changes
```

**使用例（オプション付き）:**
```json
{
  "agent": "inspector",
  "c1": "code",
  "c2": "analyze",
  "c3": "complexity",
  "options": ["-f=src/main.ts"]
}
```

実行されるコマンド:
```bash
deno run --allow-read --allow-write --allow-env --allow-run --allow-net --no-config jsr:@aidevtool/climpt --config=inspector-code analyze complexity -f=src/main.ts
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