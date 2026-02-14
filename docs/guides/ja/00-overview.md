[English](../en/00-overview.md) | [日本語](../ja/00-overview.md)

# Iterate Agent 導入ガイド

Climpt と Iterate Agent を使って、GitHub Issue や Project
を自動的に処理する自律型開発環境を構築するためのガイドです。

## このガイドの対象者

- AI 支援による開発自動化に興味がある方
- GitHub Issue/Project ベースの開発ワークフローを自動化したい方
- Claude Code を活用した開発効率化を検討している方

## ガイドの構成

本ガイドは段階的に環境を構築できるよう、以下のファイルに分かれています：

| 章  | ファイル                                                   | 内容                              |
| --- | ---------------------------------------------------------- | --------------------------------- |
| 0.1 | [00-1-concepts.md](./00-1-concepts.md)                     | **Agent の基本概念（何を/なぜ）** |
| 1   | [01-prerequisites.md](./01-prerequisites.md)               | 前提条件（Deno、gh CLI）          |
| 2   | [02-climpt-setup.md](./02-climpt-setup.md)                 | Climpt のインストールと設定       |
| 3   | [03-instruction-creation.md](./03-instruction-creation.md) | 指示書（プロンプト）の作成方法    |
| 4   | [04-iterate-agent-setup.md](./04-iterate-agent-setup.md)   | Iterate Agent の設定と実行        |

### 詳細解説（上級者向け）

| 章 | ファイル                                           | 内容                                           |
| -- | -------------------------------------------------- | ---------------------------------------------- |
| 5  | [05-architecture.md](./05-architecture.md)         | 全体像編（アーキテクチャ、実行フロー）         |
| 6  | [06-config-files.md](./06-config-files.md)         | 設定ファイル編（app.yml、user.yml）            |
| 7  | [07-dependencies.md](./07-dependencies.md)         | 依存構造編（レジストリ、MCP、パッケージ）      |
| 8  | [08-prompt-structure.md](./08-prompt-structure.md) | プロンプト構造編（手動作成、テンプレート変数） |

## 全体像

Climpt は5つの層から構成されており、Iterate Agent
を頂点とした自律実行を実現しています。

- **最上位層**: Iterator/Reviewer Agent — GitHub Issue/Project と連携し反復制御
- **中間層**: delegate-climpt-agent Skill — コマンド検索、オプション解決
- **実行層**: Sub-Agent (climpt-agent.ts) — プロンプトを取得し自律的に作業
  - _(ここでコンテクスト分離)_
- **ツール層**: CLI / MCP — プロンプト取得のインターフェース
- **設定層**: registry.json / prompts/ — プロンプトテンプレート・コマンド定義

### 動作の流れ

1. **最上位層**: Iterate Agent が GitHub Issue/Project から要件を取得
2. **中間層**: delegate-climpt-agent Skill でコマンドを検索・オプション解決
3. **実行層**: Sub-Agent がプロンプトを取得し、自律的に作業を実行
4. **ツール層**: CLI/MCP が設定層からプロンプトを読み込み
5. **設定層**: テンプレート変数を置換して最終プロンプトを生成

**ポイント**: 最上位層と実行層は別々の Claude Agent SDK
セッションで動作し、コンテクスト分離により柔軟な自律動作を実現しています。詳細は
[05-architecture.md](./05-architecture.md) を参照してください。

## セットアップの流れ

1. **前提条件の準備** — Deno 2.x、GitHub CLI (gh)、gh 認証
2. **Climpt のセットアップ** — インストール、`climpt init`、Claude Code
   プラグイン
3. **指示書の作成**（オプション） —
   `meta create instruction`、`meta build frontmatter`、`/reg`
4. **Iterate Agent の実行** — `iterate-agent --init`、`--issue` / `--project`
   で実行
5. **仕組みの理解**（上級者向け） —
   アーキテクチャ、設定ファイル、依存構造、プロンプト構造
