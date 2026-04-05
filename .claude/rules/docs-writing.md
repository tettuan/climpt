---
globs: ["agents/docs/**/*.md", "docs/**/*.md"]
---

# Docs Writing Rule

技術ドキュメントを新規作成・セクション追加する際は、`/docs-writing` skill を参照し、5段階抽象フレームワークに従うこと。

## 適用条件

- `agents/docs/` 配下の builder guide, design doc の新規作成・セクション追加
- `docs/` 配下の guide, reference の新規作成・セクション追加
- 既存ドキュメントの構造的な書き直し

## 必須手順

1. ドキュメントを書く前に `/docs-writing` skill を参照する
2. 5段階のどのレベルが必要か判定する (Decision Process)
3. Level 2 (Structure/Contract) から書き始める
4. 各レベル間の接続 (上: "because", 下: "therefore") を確認する

## Quick Check

- [ ] Dead-level abstracting していないか (1つのレベルに留まっていないか)
- [ ] Level を飛ばしていないか (原則 → 具体例 の直接接続は不可)
- [ ] 暗黙の構造がないか (ソースコードを読まないと分からない情報は Level 2 に記載)
