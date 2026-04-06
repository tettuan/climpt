---
layout: default
title: ホーム
---

# Climpt ドキュメント

[English](../en/) | [日本語](../ja/)

CLIプロンプト管理ツール。

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
- [はじめに](10-getting-started-guide.md)
- [Runner 設定リファレンス](11-runner-reference.md)
- [トラブルシューティングガイド](12-troubleshooting.md)
- [Agent 作成チュートリアル](13-agent-creation-tutorial.md)
- [Steps Registry ガイド](14-steps-registry-guide.md)
- [ワークフローガイド](15-workflow-guide.md)

## Examples（E2E動作確認）

リリース前に [`examples/`](../../../examples/)
スクリプトを実行して、エンドツーエンドの動作を確認してください：

- [01-04 Setup](../../../examples/01_check_prerequisites/) -
  インストールと初期化
- [05-09 CLI Basic](../../../examples/05_echo_test/) - 基本CLIコマンド
- [10-12 Docs](../../../examples/10_docs_list/) - ドキュメントインストーラー
- [13-24 Agents](../../../examples/13_list_agents/) - エージェントフレームワーク
- [35-37 Registry](../../../examples/35_generate_registry/) - レジストリ生成
- [38-39 MCP](../../../examples/38_mcp_start_server/) - MCPサーバーとIDE連携

## リンク

- [GitHub リポジトリ](https://github.com/tettuan/climpt)
- [JSR パッケージ](https://jsr.io/@aidevtool/climpt)
