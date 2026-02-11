[English](../en/07-dependencies.md) | [日本語](../ja/07-dependencies.md)

# 7. 依存構造編

Climpt のレジストリ、MCP サーバー、外部パッケージとの依存関係を説明します。

## 7.1 パッケージ依存関係

### 主要パッケージ

| パッケージ                         | 役割                         | JSR URL                                |
| ---------------------------------- | ---------------------------- | -------------------------------------- |
| `@aidevtool/climpt`                | メインパッケージ             | `jsr:@aidevtool/climpt`                |
| `@tettuan/breakdown`               | コア機能（テンプレート処理） | `jsr:@tettuan/breakdown`               |
| `@aidevtool/frontmatter-to-schema` | レジストリ生成               | `jsr:@aidevtool/frontmatter-to-schema` |

`@aidevtool/climpt` のエントリポイント: `/cli`（CLI）、`/mcp`（MCP
サーバー）、`/reg`（レジストリ生成）、`/agents/iterator`（Iterate Agent）

`@tettuan/breakdown` の機能: YAML
設定ファイル解析、プロンプトファイル読み込み、テンプレート変数置換

`@aidevtool/frontmatter-to-schema` の機能: フロントマターからレジストリ生成

---

## 7.2 レジストリの仕組み

### registry.json の役割

レジストリは、利用可能なすべてのコマンドとそのメタデータを保持するファイルです。

```json
{
  "version": "1.0.0",
  "description": "Climpt command registry",
  "tools": {
    "availableConfigs": ["git", "meta", "code"],
    "commands": [
      {
        "c1": "git",
        "c2": "decide-branch",
        "c3": "working-branch",
        "description": "Decide branch strategy based on task",
        "usage": "climpt-git decide-branch working-branch",
        "options": {
          "edition": ["default"],
          "adaptation": ["default"],
          "file": false,
          "stdin": true,
          "destination": false
        }
      }
    ]
  }
}
```

| 用途           | 説明                            |
| -------------- | ------------------------------- |
| MCP サーバー   | 利用可能なツールを AI に通知    |
| CLI ヘルプ     | `--help` でオプション情報を表示 |
| バリデーション | 無効なコマンドの検出            |
| コマンド検索   | キーワードによるコマンド検索    |

### レジストリのスキーマ

```typescript
interface Registry {
  version: string;
  description: string;
  tools: {
    availableConfigs: string[];
    commands: Command[];
  };
}

interface Command {
  c1: string;
  c2: string;
  c3: string;
  description: string;
  usage: string;
  options: {
    edition: string[];
    adaptation: string[];
    file: boolean;
    stdin: boolean;
    destination: boolean;
  };
  uv?: Array<{ [key: string]: string }>;
}
```

---

## 7.3 レジストリの生成

### 生成フロー

1. `.agent/climpt/prompts/**/*.md` をスキャン
2. 各ファイルのフロントマター（c1, c2, c3, description, options 等）を抽出
3. `registry.schema.json` に従って変換
4. `.agent/climpt/registry.json` を出力

### 生成コマンド

```bash
# Claude Code 内
/reg

# Deno Task
deno task generate-registry

# JSR 直接実行
deno run --allow-read --allow-write --allow-env jsr:@aidevtool/climpt/reg
```

### オプション

```bash
deno run jsr:@aidevtool/climpt/reg \
  --base=.agent/climpt \
  --input="prompts/**/*.md" \
  --output=registry.json \
  --template=registry.schema.json
```

| オプション   | 説明               | デフォルト        |
| ------------ | ------------------ | ----------------- |
| `--base`     | ベースディレクトリ | `.agent/climpt`   |
| `--input`    | 入力 glob パターン | `prompts/**/*.md` |
| `--output`   | 出力ファイル       | `registry.json`   |
| `--template` | スキーマファイル   | (内蔵)            |

---

## 7.4 MCP サーバーの動作

### MCP とは

MCP（Model Context Protocol）は、AI
アシスタントが外部ツールと対話するための標準プロトコルです。

### MCP ツール一覧

| ツール     | 機能                     | パラメータ                             |
| ---------- | ------------------------ | -------------------------------------- |
| `search`   | キーワードでコマンド検索 | `query`, `agent?`                      |
| `describe` | コマンド詳細取得         | `c1`, `c2`, `c3`, `agent?`             |
| `execute`  | コマンド実行             | `c1`, `c2`, `c3`, `stdin?`, `options?` |

### 使用例

```javascript
// コマンド検索
search({ query: "branch" });

// コマンド実行
execute({
  c1: "git",
  c2: "decide-branch",
  c3: "working-branch",
  stdin: "バグ修正の実装",
});

// 別エージェントのコマンド検索
search({ query: "analyze", agent: "inspector" });
```

### MCP 設定

```json
// .mcp.json または ~/.claude.json
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
        "--allow-run",
        "jsr:@aidevtool/climpt/mcp"
      ]
    }
  }
}
```

---

## 7.5 Claude Code プラグインとの連携

### プラグインが提供する機能

| 機能                          | 説明                                   |
| ----------------------------- | -------------------------------------- |
| `delegate-climpt-agent` Skill | Climpt エージェントにタスクを委任      |
| 自然言語コマンド              | 自然言語から適切なコマンドを検索・実行 |
| Git ワークフロー              | コミットグループ化、ブランチ管理       |

Claude Code プラグインは Skill 呼び出し、MCP Server、Iterate Agent の3つの経路で
Climpt コア機能（コマンド実行、プロンプト生成、レジストリ管理）に接続します。

### データフロー

ユーザー/AI → CLI/MCP/Plugin → registry.json（コマンド特定） →
app.yml（パス解決） → f_default.md（テンプレート変数置換） → プロンプト出力
