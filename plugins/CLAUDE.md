# climpt-plugins

Claude Code から Climpt コマンドを呼び出すためのプラグイン群。

## 目的

ユーザーの自然言語リクエストを Climpt コマンドにマッチングし、
サブエージェントを通じて実行する。これにより Claude Code が Climpt
の言語処理タスク（コマンド→プロンプト展開）を活用できる。

## 依存関係のルール

プラグインは独立配布されるため、ルートの import map (`deno.json` の `imports`)
に依存してはならない。 npm/jsr パッケージは直接指定 (`npm:@scope/pkg@version`)
で記述すること。

## リファレンス

- 詳細: `README.md`
- 構築資料: `docs/reference/`
