# MCP 連携仕様

Climpt Agent と Climpt MCP サーバーの連携仕様を説明します。

## 概要

Climpt Agent は Climpt MCP サーバーを通じてコマンドの検索・詳細取得・実行を行います。

## MCP サーバー設定

### .mcp.json

```json
{
  "mcpServers": {
    "climpt": {
      "type": "stdio",
      "command": "deno",
      "args": [
        "run",
        "--allow-read",
        "--allow-write",
        "--allow-net",
        "--allow-env",
        "--allow-run",
        "${CLAUDE_PLUGIN_ROOT}/../src/mcp/index.ts"
      ],
      "env": {}
    }
  }
}
```

### 環境変数

| Variable | Description |
|----------|-------------|
| `${CLAUDE_PLUGIN_ROOT}` | プラグインディレクトリの絶対パス |

## MCP Tools

### search

自然言語クエリから類似コマンドを検索します。

**ツール名:** `mcp__climpt__search`

**パラメータ:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | Yes | - | 検索クエリ |
| `agent` | string | No | `"climpt"` | エージェント名 |

**レスポンス:**

```typescript
interface SearchResult {
  c1: string;           // ドメイン識別子
  c2: string;           // アクション識別子
  c3: string;           // ターゲット識別子
  description: string;  // コマンド説明
  score: number;        // 類似度スコア (0-1)
}
```

**使用例:**

```
mcp__climpt__search({
  "query": "変更をグループ化してコミット",
  "agent": "climpt"
})
```

**レスポンス例:**

```json
[
  {
    "c1": "climpt-git",
    "c2": "group-commit",
    "c3": "unstaged-changes",
    "description": "Group file changes by semantic proximity and execute multiple commits sequentially",
    "score": 0.92
  },
  {
    "c1": "climpt-git",
    "c2": "decide-branch",
    "c3": "working-branch",
    "description": "Analyze task content and decide whether to create a new branch",
    "score": 0.45
  }
]
```

### describe

C3L 識別子からコマンドの詳細情報を取得します。

**ツール名:** `mcp__climpt__describe`

**パラメータ:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `agent` | string | No | `"climpt"` | エージェント名 |
| `c1` | string | Yes | - | ドメイン識別子 |
| `c2` | string | Yes | - | アクション識別子 |
| `c3` | string | Yes | - | ターゲット識別子 |

**レスポンス:**

```typescript
interface CommandDescription {
  c1: string;
  c2: string;
  c3: string;
  description: string;
  usage?: string;
  options?: {
    edition?: string[];
    adaptation?: string[];
    file?: boolean;
    stdin?: boolean;
    destination?: boolean;
  };
}
```

**使用例:**

```
mcp__climpt__describe({
  "agent": "climpt",
  "c1": "climpt-git",
  "c2": "group-commit",
  "c3": "unstaged-changes"
})
```

### execute

コマンドを実行し、指示プロンプトを取得します。

**ツール名:** `mcp__climpt__execute`

**パラメータ:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `agent` | string | Yes | - | エージェント名 (`"climpt"`) |
| `c1` | string | Yes | - | ドメイン識別子 |
| `c2` | string | Yes | - | アクション識別子 |
| `c3` | string | Yes | - | ターゲット識別子 |
| `options` | object | No | `{}` | コマンドオプション |

**レスポンス:**

指示ドキュメント（プロンプト）がテキストとして返されます。

**使用例:**

```
mcp__climpt__execute({
  "agent": "climpt",
  "c1": "climpt-git",
  "c2": "group-commit",
  "c3": "unstaged-changes",
  "options": {}
})
```

### reload

レジストリキャッシュをリロードします。

**ツール名:** `mcp__climpt__reload`

**パラメータ:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `agent` | string | No | `"climpt"` | エージェント名 |

**使用例:**

```
mcp__climpt__reload({
  "agent": "climpt"
})
```

## Registry 構造

### ファイルパス

```
.agent/climpt/registry.json
```

### スキーマ

```typescript
interface Registry {
  version: string;
  description: string;
  tools: {
    availableConfigs?: string[];
    commands: Command[];
  };
}

interface Command {
  c1: string;           // ドメイン識別子
  c2: string;           // アクション識別子
  c3: string;           // ターゲット識別子
  description: string;  // コマンド説明
  usage?: string;       // 使用方法
  options?: {
    edition?: string[];
    adaptation?: string[];
    file?: boolean;
    stdin?: boolean;
    destination?: boolean;
  };
}
```

### 現在のコマンド一覧

#### climpt-git

| c2 | c3 | Description |
|----|-----|-------------|
| `decide-branch` | `working-branch` | タスク内容に基づいてブランチ作成判断 |
| `find-oldest` | `descendant-branch` | 最古の関連ブランチを検索・マージ |
| `group-commit` | `unstaged-changes` | 変更をセマンティック単位でコミット |
| `list-select` | `pr-branch` | PR付きブランチ一覧から次のターゲット選択 |
| `merge-up` | `base-branch` | 派生ブランチを親ブランチにマージ |

#### climpt-meta

| c2 | c3 | Description |
|----|-----|-------------|
| `build` | `frontmatter` | C3L v0.5 準拠 frontmatter 生成 |
| `create` | `instruction` | 新規 instruction ファイル作成 |

## コマンド実行フロー

```
┌──────────────────────────────────────────────────────────────┐
│                     Climpt MCP Server                        │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ execute ツール                                           │ │
│  │                                                         │ │
│  │ 1. agent, c1, c2, c3, options を受け取る                │ │
│  │ 2. configParam を構築:                                  │ │
│  │    - agent === "climpt" → c1 をそのまま使用             │ │
│  │    - それ以外 → `${agent}-${c1}` を使用                 │ │
│  │ 3. Deno で Climpt CLI を実行:                           │ │
│  │    deno run jsr:@aidevtool/climpt                      │ │
│  │      --config=${configParam}                           │ │
│  │      ${c2}                                             │ │
│  │      ${c3}                                             │ │
│  │ 4. stdout を返却 (指示プロンプト)                       │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

## 類似度検索アルゴリズム

### 概要

`search` ツールは TF-IDF ベースのコサイン類似度を使用してコマンドを検索します。

### 実装詳細

```
1. クエリをトークン化
2. 各コマンドの description をトークン化
3. TF-IDF ベクトルを計算
4. コサイン類似度でランキング
5. スコア降順でソート
```

### スコアの解釈

| Score Range | 解釈 |
|-------------|------|
| 0.8 - 1.0 | 非常に高い一致 |
| 0.5 - 0.8 | 中程度の一致 |
| 0.2 - 0.5 | 低い一致 |
| 0.0 - 0.2 | ほぼ無関係 |

## エラーハンドリング

### コマンドが見つからない

```json
{
  "error": "Command not found",
  "c1": "climpt-git",
  "c2": "invalid-command",
  "c3": "target"
}
```

### レジストリ読み込みエラー

```json
{
  "error": "Failed to load registry",
  "path": ".agent/climpt/registry.json",
  "details": "File not found"
}
```

### 実行エラー

```json
{
  "error": "Execution failed",
  "command": "climpt-git group-commit unstaged-changes",
  "stderr": "<error output>"
}
```

## ベストプラクティス

1. **search → describe → execute** の順序で呼び出す
2. 検索結果が複数ある場合は `score` と `description` を確認して選択
3. `reload` は registry.json を更新した後に実行
4. `agent` パラメータは常に `"climpt"` を使用
