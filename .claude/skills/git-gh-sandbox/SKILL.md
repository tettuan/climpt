---
name: git-gh-sandbox
description: Use when executing git or gh commands that require network access. Explains sandbox restrictions for git push, pull, fetch, clone, and all gh commands.
allowed-tools: [Bash, Read, Edit, Grep, Glob]
---

# git/gh コマンドのサンドボックス制限

## 概要

Claude Code で git/gh コマンドを実行する場合、ネットワークアクセスが必要なコマンドは `dangerouslyDisableSandbox: true` が必要。

## 対象コマンド

| カテゴリ | コマンド |
|---------|---------|
| Git ネットワーク | `git push`, `git pull`, `git fetch`, `git clone` |
| GitHub CLI | `gh` コマンド全般 |

## 使用例

### Git push

```typescript
Bash({
  command: "git push -u origin feature-branch",
  dangerouslyDisableSandbox: true,
})
```

### Git pull/fetch

```typescript
Bash({
  command: "git pull origin main",
  dangerouslyDisableSandbox: true,
})
```

### GitHub CLI

```typescript
Bash({
  command: "gh pr create --base develop --head feature-branch",
  dangerouslyDisableSandbox: true,
})
```

```typescript
Bash({
  command: "gh pr merge 123 --merge",
  dangerouslyDisableSandbox: true,
})
```

## サンドボックス不要なコマンド

以下はローカル操作のため `dangerouslyDisableSandbox` 不要:

- `git status`
- `git add`
- `git commit`
- `git log`
- `git diff`
- `git branch`
- `git checkout`
- `git merge` (ローカルマージ)
