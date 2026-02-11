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

- [01-04 Setup](../../../examples/01_check_prerequisites/) -
  インストールと初期化
- [05-09 CLI Basic](../../../examples/05_echo_test/) - 基本CLIコマンド
- [10-12 Docs](../../../examples/10_docs_list/) - ドキュメントインストーラー
- [13-23 Agents](../../../examples/13_list_agents/) - エージェントフレームワーク
- [27-28 Registry](../../../examples/27_generate_registry/) - レジストリ生成
- [29-30 MCP](../../../examples/29_mcp_start_server/) - MCPサーバーとIDE連携

## リンク

- [GitHub リポジトリ](https://github.com/tettuan/climpt)
- [JSR パッケージ](https://jsr.io/@aidevtool/climpt)
