# iterate-agent

Claude Agent SDK を使った自律型開発エージェント。

## 目的

GitHub Issue/Project から要件を取得し、delegate-climpt-agent Skill を
通じてタスクを実行。完了条件を満たすまで反復する。

## 実行

```bash
deno task iterate-agent --issue 123
deno task iterate-agent --project 5
```

## リファレンス

- 詳細: `README.md`
- 設計: `docs/internal/iterate-agent-design.md`
