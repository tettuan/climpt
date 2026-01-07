- Deno, JSR
- 全域性

# このプロジェクトは？

ClI + Prompt = Climpt という命名。
CLIでPromptsを表示する。

Prompt呼び出しは、https://jsr.io/@tettuan/breakdown を実行する wrap パッケージである。

MCPや、呼び出し方の定義ファイルが、Climptレポジトリに存在する。

# Git

develop, main への直接pushは禁止。PR作成してからリモートMergeする。

- ブランチ戦略: `/branch-management` skill 参照
- リリース手順: `/release-procedure` skill 参照

基本フロー: `作業ブランチ -> release/* -> develop -> main`

## サンドボックス制限

Claude Code で git/gh コマンドを実行する場合、`dangerouslyDisableSandbox: true` が必要:

```typescript
Bash({
  command: "git push -u origin feature-branch",
  dangerouslyDisableSandbox: true,
})
```

対象: `git push`, `git pull`, `git fetch`, `git clone`, `gh` コマンド全般

## CI での JSR 接続問題

`deno task ci` 実行時に JSR 接続エラーが発生した場合:

```
error: JSR package manifest for '@std/path' failed to load.
Import 'https://jsr.io/@std/path/meta.json' failed.
```

これはサンドボックス制限が原因の可能性が高い。`dangerouslyDisableSandbox: true` で再実行:

```typescript
Bash({
  command: "deno task ci",
  dangerouslyDisableSandbox: true,
})
```

# Iterate Agent

Claude Agent SDK 使用時も `dangerouslyDisableSandbox: true` が必要:

```typescript
Bash({
  command: "deno run -A jsr:@aidevtool/climpt/agents/iterator --issue 123",
  dangerouslyDisableSandbox: true,
})
```
