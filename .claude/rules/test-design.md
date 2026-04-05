---
globs: ["*_test.ts", "*.test.ts", "*_test.tsx", "*.test.tsx"]
---

# Test Design Rule

テストファイルを新規作成・修正・レビューする際は、必ず `/test-design` skill を先に実行し、その指針に従うこと。

## 必須手順

1. テストコードを書く前に `/test-design` skill を実行する
2. skill の Decision Framework (source of truth / relationship / diagnosability) に基づいてテスト設計を行う
3. 以下の Anti-Pattern を避ける:
   - ハードコードされた期待値 (source of truth から import する)
   - マジックナンバー (`assertEquals(x, 4)` ではなく、権威ある定義から導出する)
   - 空コレクションでの暗黙パス (non-vacuity を検証する)
   - 不透明な失敗メッセージ (What/Where/How-to-fix を含める)

## テストパターン選択

- Contract Test: consumer の要件を provider が満たすか検証 (修正方向が一意)
- Conformance Test: 2つの peer 設定の相互整合性を検証 (IF/THEN で分岐)
- Invariant Test: コレクション全体で常に成立すべき性質を検証
