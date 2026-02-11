# Claude Agent SDK

## 実行環境とサンドボックス

### サンドボックスの仕組み

Claude Agent SDK は内部で Claude Code プロセスを起動し、SDK
自体にもサンドボックス設定が存在する：

- `enabled`: サンドボックスの有効/無効
- `autoAllowBashIfSandboxed`: サンドボックス時に Bash を自動許可
- `allowUnsandboxedCommands`: サンドボックスなしコマンドを許可
- `network`: ネットワーク設定
- `ignoreViolations`: 違反を無視するパスのリスト

型定義: `/entrypoints/sandboxTypes.d.ts`

**注**: デフォルト値については公式ドキュメントで確認できていない。型定義上は全て
optional となっている。

### 問題: Claude Code の Bash ツール経由での実行が失敗する

Claude Agent SDK を Claude Code の Bash
ツールから実行すると、以下のエラーが発生する：

```
Error: EPERM: operation not permitted, open '/Users/[user]/.claude/projects/...'
Error: EPERM: operation not permitted, open '/Users/[user]/.claude/statsig/...'
Error: EPERM: operation not permitted, open '/Users/[user]/.claude/telemetry/...'
```

#### 原因

Claude Code の Bash ツールは、デフォルトでサンドボックスモードで実行される。
サンドボックスの書き込み許可リストには以下のディレクトリのみが含まれている：

```
"write": {
  "allowOnly": [
    "/tmp/claude",
    "/Users/[user]/.npm/_logs",
    "/Users/[user]/.claude/debug",
    "."
  ]
}
```

Claude Agent SDK は以下のディレクトリへの書き込みを必要とする：

- `~/.claude/projects/` - セッションログ
- `~/.claude/statsig/` - 統計情報
- `~/.claude/telemetry/` - テレメトリデータ

これらのディレクトリは許可リストに含まれていないため、書き込みが失敗する。

#### 解決策

Bash ツール実行時に `dangerouslyDisableSandbox: true`
を指定してサンドボックスを無効化する：

```typescript
Bash({
  command: "deno run --allow-all /path/to/test-sdk-simple.ts",
  description: "Run Claude Agent SDK test",
  dangerouslyDisableSandbox: true,
});
```

#### 実行時間の比較

- **サンドボックス有効（失敗）**: 60秒以上でタイムアウト
- **サンドボックス無効（成功）**: 約5秒で完了
- **ターミナル直接実行（成功）**: 約38秒で完了

## テストスクリプト

### test-sdk-simple.ts

最もシンプルな SDK テスト。ツールなし、Haiku モデル使用：

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

const response = query({
  prompt: "hello",
  tools: [], // No tools - simplest possible execution
  model: "claude-haiku-4-5-20251001", // Fastest model
});

for await (const message of response) {
  console.log(JSON.stringify(message, null, 2));
  if (message.type === "result") {
    console.log("✅ OK");
  }
}
```

### test-sdk-minimal.ts

Bash ツールを使用する最小限のテスト：

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

const response = query({
  prompt: "Say hello and list the files in the current directory",
  options: {
    allowedTools: ["Bash"],
  },
});

for await (const message of response) {
  // メッセージ処理...
}
```

## Sandbox 設計（2026-01-11 更新）

### 二重 Sandbox の問題

Claude Code 内から Agent を実行する場合、二重の sandbox が存在する：

```
Claude Code Bash tool sandbox (外側)
  └─ Agent Runner (agents/scripts/run-agent.ts)
       └─ SDK sandbox (内側) ← 我々が設定
```

**結果**: 内側の SDK sandbox で `api.anthropic.com` を許可しても、外側の Bash
tool sandbox がブロックする。

### 解決策

1. **ターミナルから直接実行** - sandbox 外で実行
   ```bash
   deno run --allow-all agents/scripts/run-agent.ts --agent iterator --issue 123
   ```

2. **dangerouslyDisableSandbox 使用** - Claude Code 内から実行時
   ```typescript
   Bash({
     command:
       "deno run --allow-all agents/scripts/run-agent.ts --agent iterator --issue 123",
     dangerouslyDisableSandbox: true,
   });
   ```

### SDK Sandbox 設定

`agents/runner/sandbox-defaults.ts` で以下を設定：

**Network allowedDomains:**

- `api.anthropic.com`
- `statsig.anthropic.com`
- `sentry.anthropic.com`
- `*.anthropic.com`
- `*.*.anthropic.com`
- GitHub、Deno、npm 関連ドメイン

**Filesystem ignoreViolations:**

- `~/.claude/projects/`
- `~/.claude/statsig/`
- `~/.claude/telemetry/`

## 記録日

2025-12-20（更新: 2026-01-11）
