- Deno, JSR
- 全域性
- sub agentsへ移譲しコンテキスト節約

# このプロジェクトは？

ClI + Prompt = Climpt という命名。
CLIでPromptsを表示する。

Prompt呼び出しは、https://jsr.io/@tettuan/breakdown を実行する wrap パッケージである。

MCPや、エージェント、呼び出し設定や定義ファイルが、Climptレポジトリに存在する。

# Git

develop, main への直接pushは禁止。PR作成してからリモートMergeする。

- ブランチ戦略: `/branch-management` skill 参照
- リリース手順: `/release-procedure` skill 参照

基本フロー: `作業ブランチ -> release/* -> develop -> main`

## サンドボックス制限

- git/gh コマンド: `/git-gh-sandbox` skill 参照
- CI 実行: `/local-ci` skill 参照
- CI エラー対処: `/ci-troubleshooting` skill 参照
