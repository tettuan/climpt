# 環境別の注意点

| 環境 | 注意点 |
|---|---|
| ターミナル | 推奨。env クリーン |
| Claude Code 内 | CLAUDE_CODE_ENTRYPOINT 等を unset。SDK query の子プロセスがネスト制約で失敗する |
| CI | OAuth 認証が必要。ANTHROPIC_API_KEY だけでは SDK query は動かない |

## Claude Code 内での実行

Claude Code の Bash ツールから実行すると、環境変数 `CLAUDE_CODE_ENTRYPOINT`, `CLAUDECODE`, `CLAUDE_CODE_SESSION_ID` が子プロセスに継承される。SDK `query()` はこれを検知してネスト実行となり、子プロセスが失敗する。

test-runner-minimal.ts はこれらの環境変数を明示的にクリアして回避している。

## 関連テストスクリプト

- SDK query テスト: `examples/scripts/test-sdk-query.ts`
- Plan mode テスト: `examples/scripts/test-plan-mode.ts`
