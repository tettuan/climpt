[English](../en/00-overview.md) | [日本語](../ja/00-overview.md)

# Iterate Agent 導入ガイド

Climpt と Iterate Agent を使って、GitHub Issue や Project を自動的に処理する自律型開発環境を構築するためのガイドです。

## このガイドの対象者

- AI 支援による開発自動化に興味がある方
- GitHub Issue/Project ベースの開発ワークフローを自動化したい方
- Claude Code を活用した開発効率化を検討している方

## ガイドの構成

本ガイドは段階的に環境を構築できるよう、以下のファイルに分かれています：

| 章 | ファイル | 内容 |
|----|---------|------|
| 1 | [01-prerequisites.md](./01-prerequisites.md) | 前提条件（Deno、gh CLI） |
| 2 | [02-climpt-setup.md](./02-climpt-setup.md) | Climpt のインストールと設定 |
| 3 | [03-instruction-creation.md](./03-instruction-creation.md) | 指示書（プロンプト）の作成方法 |
| 4 | [04-iterate-agent-setup.md](./04-iterate-agent-setup.md) | Iterate Agent の設定と実行 |

### 詳細解説（上級者向け）

| 章 | ファイル | 内容 |
|----|---------|------|
| 5 | [05-architecture.md](./05-architecture.md) | 全体像編（アーキテクチャ、実行フロー） |
| 6 | [06-config-files.md](./06-config-files.md) | 設定ファイル編（app.yml、user.yml） |
| 7 | [07-dependencies.md](./07-dependencies.md) | 依存構造編（レジストリ、MCP、パッケージ） |
| 8 | [08-prompt-structure.md](./08-prompt-structure.md) | プロンプト構造編（手動作成、テンプレート変数） |

## 全体像

```
┌────────────────────────────────────────────────────────────────┐
│                     Iterate Agent システム                      │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐     │
│  │   GitHub     │    │   Climpt     │    │  Claude Code │     │
│  │ Issue/Project│───▶│   Skills     │───▶│   Plugin     │     │
│  └──────────────┘    └──────────────┘    └──────────────┘     │
│         │                   │                   │              │
│         │                   ▼                   │              │
│         │           ┌──────────────┐            │              │
│         │           │  指示書      │            │              │
│         │           │ (Prompts)   │            │              │
│         │           └──────────────┘            │              │
│         │                   │                   │              │
│         ▼                   ▼                   ▼              │
│  ┌─────────────────────────────────────────────────────┐      │
│  │              Iterate Agent (自律実行)               │      │
│  │                                                     │      │
│  │  1. Issue/Project から要件取得                      │      │
│  │  2. delegate-climpt-agent Skill でタスク実行       │      │
│  │  3. 完了条件をチェック                              │      │
│  │  4. 未完了なら次のタスクへ                          │      │
│  └─────────────────────────────────────────────────────┘      │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

## セットアップの流れ

```
1. 前提条件の準備
   ├── Deno 2.x インストール
   ├── GitHub CLI (gh) インストール
   └── gh 認証

2. Climpt のセットアップ
   ├── Climpt インストール
   ├── climpt init で初期化
   └── Claude Code プラグインインストール

3. 指示書の作成（オプション）
   ├── meta create instruction で新規作成
   ├── meta build frontmatter でフロントマター生成
   └── /reg でレジストリ再生成

4. Iterate Agent の実行
   ├── iterate-agent --init で初期化
   └── --issue または --project で実行

5. 仕組みの理解（上級者向け）
   ├── 全体像編: アーキテクチャと実行フロー
   ├── 設定ファイル編: app.yml、user.yml の詳細
   ├── 依存構造編: レジストリ、MCP、パッケージ関係
   └── プロンプト構造編: 手動作成、テンプレート変数
```

## 必要な環境

| 要件 | 最小バージョン | 用途 |
|------|---------------|------|
| Deno | 2.x | Climpt 実行環境 |
| GitHub CLI (gh) | 2.x | GitHub API アクセス |
| Claude Code | 最新 | AI 支援開発 |

## 所要時間の目安

- 前提条件の準備: 10-15分
- Climpt のセットアップ: 5-10分
- 指示書の作成: 必要に応じて
- Iterate Agent の実行: 即時

## 次のステップ

[01-prerequisites.md](./01-prerequisites.md) へ進んで、前提条件の準備を始めましょう。
