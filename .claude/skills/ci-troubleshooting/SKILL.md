---
name: ci-troubleshooting
description: Use when user encounters CI errors, JSR connection issues, 'deno task ci' failures, or sandbox-related build problems. Provides solutions for common CI issues.
allowed-tools: [Bash, Read, Edit, Grep, Glob]
---

# CI トラブルシューティング

## JSR 接続問題

`deno task ci` 実行時に JSR 接続エラーが発生した場合:

```
error: JSR package manifest for '@std/path' failed to load.
Import 'https://jsr.io/@std/path/meta.json' failed.
```

### 原因

これはサンドボックス制限が原因の可能性が高い。

### 解決方法

`dangerouslyDisableSandbox: true` で再実行:

```typescript
Bash({
  command: "deno task ci",
  dangerouslyDisableSandbox: true,
})
```

## よくあるエラーと対処

### Import failed エラー

```
error: Module not found "https://jsr.io/..."
```

→ サンドボックスが外部ネットワークをブロックしている。`dangerouslyDisableSandbox: true` で再実行。

### Permission denied エラー

```
error: Uncaught PermissionDenied: ...
```

→ Deno のパーミッション不足の可能性。`deno task ci` はすでに適切なフラグを設定しているので、サンドボックス制限を確認。

## 関連 skill

- CI 実行方法: `/local-ci` skill 参照
- git/gh コマンドのサンドボックス制限: `/git-gh-sandbox` skill 参照
