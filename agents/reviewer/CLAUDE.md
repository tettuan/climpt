# review-agent

Claude Agent SDK を使った自律型レビューエージェント。

## 目的

GitHub Issue から要件を取得し、実装が要件を満たしているかを検証。
不足箇所を新たなissueとして登録する。

## 実行

```bash
deno task review-agent --project senlygan-desktop --issue 24
```

## iterate-agent との関係

- iterate-agent: 実装担当
- review-agent: レビュー担当（実装の要件充足確認）

## リファレンス

- 詳細: `README.md`
- 設計: `docs/internal/review-agent-design.md`（未作成）
