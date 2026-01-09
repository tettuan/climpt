---
name: local-ci
description: Use when running 'deno task ci', local CI checks, or pre-push validation. Delegates to sub agent for context efficiency.
allowed-tools: [Bash, Read, Edit, Grep, Glob, Task]
---

# Local CI 実行

## 概要

ローカルで CI を実行してコードの品質を確認する。

**重要**: CI 実行は sub agent に委譲してコンテキストを節約すること。

## 実行方法

### Sub Agent への委譲（推奨）

```typescript
Task({
  subagent_type: "Bash",
  prompt: "deno task ci を実行して結果を報告してください",
  description: "Run local CI"
})
```

### 直接実行（サンドボックス制限に注意）

JSR 接続が必要な場合は `dangerouslyDisableSandbox: true` が必要:

```typescript
Bash({
  command: "deno task ci",
  dangerouslyDisableSandbox: true,
})
```

## CI の内容

`deno task ci` は以下を実行:

1. **Lockfile Initialization** - `deno cache deps.ts`
2. **Type Check** - `deno check`
3. **Format Check** - `deno fmt --check`
4. **Lint** - `deno lint`
5. **Test** - `deno test`

## エラー対処

### JSR 接続エラー

```
error: JSR package manifest for '@std/path' failed to load.
```

→ `/ci-troubleshooting` skill 参照

### 型エラー

型チェックで失敗した場合:
1. エラーメッセージを確認
2. 該当ファイルを修正
3. 再度 CI 実行

## プッシュ前の確認

リモートへプッシュする前に必ずローカル CI を通すこと:

```bash
deno task ci && git push origin branch-name
```
