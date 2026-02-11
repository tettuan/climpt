---
layout: default
title: ホーム
---

# Climpt ドキュメント

[English](../en/) | [日本語](../ja/)

CLIプロンプト管理ツール。Iterator、Reviewerエージェントも含まれています。

## ガイド

- [概要](00-overview.md)
- [前提条件](01-prerequisites.md)
- [Climpt セットアップ](02-climpt-setup.md)
- [指示書作成](03-instruction-creation.md)
- [Iterate Agent セットアップ](04-iterate-agent-setup.md)
- [アーキテクチャ](05-architecture.md)
- [設定ファイル](06-config-files.md)
- [依存関係](07-dependencies.md)
- [プロンプト構造](08-prompt-structure.md)

## Examples（E2E動作確認）

リリース前に [`examples/`](../../../examples/)
スクリプトを実行して、エンドツーエンドの動作を確認してください：

- [Setup](../../../examples/01_setup/) - インストールと初期化
- [CLI Basic](../../../examples/02_cli_basic/) - 基本CLIコマンド
- [MCP](../../../examples/03_mcp/) - MCPサーバーとIDE連携
- [Docs](../../../examples/04_docs/) - ドキュメントインストーラー
- [Agents](../../../examples/05_agents/) - エージェントフレームワーク
- [Registry](../../../examples/06_registry/) - レジストリ生成

## リンク

- [GitHub リポジトリ](https://github.com/tettuan/climpt)
- [JSR パッケージ](https://jsr.io/@aidevtool/climpt)
