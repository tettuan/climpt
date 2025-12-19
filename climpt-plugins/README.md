# Climpt Agent Plugin

Climpt Agent は Claude Code の Skill として動作し、開発タスクを Climpt コマンドに委譲する自律エージェントです。

## 機能

- **自然言語からのコマンド検索**: ユーザーの意図に基づいて最適な Climpt コマンドを自動検索
- **動的 Sub-agent 生成**: C3L 命名規則に基づいて実行時に Sub-agent を動的生成
- **Climpt MCP 連携**: MCP サーバー経由で Climpt コマンドを検索・実行

## 前提条件

- Deno 2.x (推奨 2.4.4+)
- Claude Code
- Climpt CLI (`jsr:@aidevtool/climpt`)

## インストール

### 1. Marketplace として登録

```bash
/plugin marketplace add <path-to-climpt-plugins>
```

### 2. プラグインをインストール

```bash
/plugin install climpt-agent
```

### 3. Claude Code を再起動

## 使用方法

以下のようなリクエストで Skill が自動発動します：

### Git 操作

- 「変更をコミットして」 → `climpt-git group-commit unstaged-changes`
- 「ブランチを決めて」 → `climpt-git decide-branch working-branch`
- 「PRブランチを選択して」 → `climpt-git list-select pr-branch`

### Meta 操作

- 「frontmatter を生成して」 → `climpt-meta build frontmatter`
- 「instruction を作成して」 → `climpt-meta create instruction`

## ディレクトリ構造

```
climpt-plugins/
├── .claude-plugin/
│   └── plugin.json           # Plugin manifest
├── skills/
│   └── delegate-climpt-agent/
│       ├── SKILL.md          # Skill 定義
│       └── scripts/
│           └── climpt-agent.ts   # Agent script
├── .mcp.json                 # MCP サーバー設定
└── README.md
```

## コンポーネント

### SKILL.md

Claude が Skill を発動する条件を定義。`description` フィールドがトリガー条件となります。

### climpt-agent.ts

Claude Agent SDK を使用して動的 Sub-agent を生成・実行するスクリプト。

### .mcp.json

Climpt MCP サーバーの設定。`search`, `describe`, `execute`, `reload` ツールを提供。

## C3L 命名規則

コマンドは C3L (Command 3-Level) 命名規則に従います：

| Level | Description | Example |
|-------|-------------|---------|
| `c1` | ドメイン識別子 | `climpt-git`, `climpt-meta` |
| `c2` | アクション識別子 | `group-commit`, `build` |
| `c3` | ターゲット識別子 | `unstaged-changes`, `frontmatter` |

Sub-agent 名は `<c1>-<c2>-<c3>` 形式で生成されます。

## ドキュメント

- [Overview](../docs/reference/climpt-agent/overview.md) - 概要とアーキテクチャ
- [Skill 仕様](../docs/reference/climpt-agent/skill-specification.md) - SKILL.md の詳細仕様
- [Agent Script 仕様](../docs/reference/climpt-agent/agent-script.md) - climpt-agent.ts の詳細仕様
- [MCP 連携](../docs/reference/climpt-agent/mcp-integration.md) - MCP サーバーとの連携仕様

## ライセンス

MIT
