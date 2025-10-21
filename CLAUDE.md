- Deno, JSR
- 全域性

# このプロジェクトは？

ClI + Prompt = Climpt という命名。
CLIでPromptsを表示する。

Prompt呼び出しは、https://jsr.io/@tettuan/breakdown を実行する wrap パッケージである。

MCPや、呼び出し方の定義ファイルが、Climptレポジトリに存在する。

# Git
develop, main への直接pushは禁止。
PR作成してからリモートMergeする。その後ローカル反映する。
mainはdevelopからのみマージ可: `other-branch -> develop -> main`
リリース時もローカル develop から リリースブランチを作成して行う。

# リリース手順

0. developブランチへ全ての作業ブランチを統合する（リリースに必要な変更に限る）
1. リリースブランチを develop から派生して作成する
2. リリース番号をあげる（deno.json, version.ts） , 基本はパッチバージョン
3. リモートpushする
4. リリースブランチ -> develop へのPRを作成する
5. CIパスしていたら developへのPRマージを実施する
6. develop -> main へのPR作成する
7. mainへマージする
8. main の最新コミットを特定し、vtagを付与する（必ずmainへ付与する）
