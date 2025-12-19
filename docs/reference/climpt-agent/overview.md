# Climpt Agent Overview

Climpt Agent は Claude Code の Skill として動作し、ユーザーのタスクを Climpt コマンドに委譲する自律エージェントです。

## 概要

Climpt Agent は以下の機能を提供します：

1. **自然言語からのコマンド検索**: ユーザーの意図に基づいて最適な Climpt コマンドを自動検索
2. **動的 Sub-agent 生成**: C3L 命名規則に基づいて実行時に Sub-agent を動的生成
3. **Climpt MCP 連携**: MCP サーバー経由で Climpt コマンドを検索・実行

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────────┐
│                        Claude Code                               │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              delegate-climpt-agent Skill                   │  │
│  │                                                            │  │
│  │  1. ユーザーの意図を解析                                    │  │
│  │  2. mcp__climpt__search で類似コマンド検索                  │  │
│  │  3. mcp__climpt__describe でコマンド詳細取得               │  │
│  │  4. mcp__climpt__execute でプロンプト取得                  │  │
│  │  5. climpt-agent.ts で Sub-agent 実行                      │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                    │
│                              ▼                                    │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    Climpt MCP Server                       │  │
│  │  Tools: search, describe, execute, reload                  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                    │
│                              ▼                                    │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                 Climpt CLI (jsr:@aidevtool/climpt)         │  │
│  │  プロンプトテンプレート → 指示ドキュメント生成             │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## コンポーネント

### 1. Plugin Manifest (plugin.json)

プラグインのメタデータを定義します。

```json
{
  "name": "climpt-agent",
  "version": "1.0.0",
  "description": "Delegate tasks to Climpt Agent for AI-assisted development workflows"
}
```

### 2. SKILL.md

Claude が自動的に Skill を発動するための記述を含みます。`description` フィールドが発動条件を決定します。

### 3. climpt-agent.ts

Claude Agent SDK を使用して動的 Sub-agent を生成・実行するスクリプト。

### 4. .mcp.json

Climpt MCP サーバーの設定を定義します。

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

## 使用方法

### 前提条件

- Deno 2.x (推奨 2.4.4+)
- Claude Code がインストール済み
- Climpt MCP サーバーが設定済み

### プラグインのインストール

1. marketplace としてディレクトリを登録:

```bash
/plugin marketplace add ./climpt-plugins
```

2. プラグインをインストール:

```bash
/plugin install climpt-agent
```

3. Claude Code を再起動

### 動作確認

以下のようなリクエストで Skill が自動発動します：

- 「変更をコミットして」
- 「ブランチを整理して」
- 「frontmatter を生成して」

## 関連ドキュメント

- [Skill 仕様](skill-specification.md) - SKILL.md の詳細仕様
- [Agent Script 仕様](agent-script.md) - climpt-agent.ts の詳細仕様
- [MCP 連携](mcp-integration.md) - Climpt MCP サーバーとの連携
