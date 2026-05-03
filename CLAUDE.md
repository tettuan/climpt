- Deno, JSR
- 全域性, AI複雑性に対する惑星モデル：コアから構築せよ
- sub agentsへ移譲しコンテキスト節約
- 後方互換性不要, fallback最小限, レビュアーが激的に細かいので綿密にコーディングする

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

# 意思決定

2 個以上の実装案・設計案を比較するときは、必ず `/option-scoring` skill を先に実行し、matrix + recommendation を提示してから判断する。詳細は `.claude/rules/option-scoring.md`。

# 会話スタイル

- 会話の主目的を考えて、主語やスコープを意識し、「何の話か」わかる境界線を明示した会話をすること。
- 主語やスコープは自然な日本語の文として語ること。「誰が: ... / 何を: ...」のような key-value 列挙や記号的分解で主体を表現しない。「私 (Claude main) が workflow.json を編集する」のように、主語・述語が繋がった文で書く。
