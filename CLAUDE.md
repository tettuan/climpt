- Deno, JSR
- 全域性

# このプロジェクトは？

ClI + Prompt = Climpt という命名。
CLIでPromptsを表示する。

Prompt呼び出しは、https://jsr.io/@tettuan/breakdown を実行する wrap パッケージである。

MCPや、呼び出し方の定義ファイルが、Climptレポジトリに存在する。

# Git
develop, main への直接pushは禁止。
PR作成してからリモートMergeする。その後ローカル反映する。
mainはdevelopからのみマージ可: `other-branch -> develop -> main`
リリース時もローカル develop から リリースブランチを作成して行う。

## サンドボックス制限

Claude Code で git のネットワーク操作（push, pull, fetch, clone など）を実行する場合、ALWAYS use `dangerouslyDisableSandbox: true`:

```typescript
Bash({
  command: "git push -u origin feature-branch",
  description: "Push branch to remote",
  dangerouslyDisableSandbox: true,
})
```

**理由**: サンドボックス環境では github.com へのネットワークアクセスが制限されており、`dangerouslyDisableSandbox: true` を指定しないと `Could not resolve host: github.com` エラーが発生する。

**対象コマンド**:
- `git push`
- `git pull`
- `git fetch`
- `git clone`
- `gh` コマンド全般（GitHub CLI）

## 1.9 リリース
`feature/release-1.9` ブランチが 1.9 リリースのベースブランチ（developに相当）。
作業ブランチは `feature/release-1.9` から派生させ、PRも `feature/release-1.9` へマージする。

# リリース手順

0. developブランチへ全ての作業ブランチを統合する（リリースに必要な変更に限る）
1. リリースブランチを develop から派生して作成する
2. リリース番号をあげる（deno.json, version.ts） , 基本はパッチバージョン
3. リモートpushする
4. リリースブランチ -> develop へのPRを作成する
5. CIパスしていたら developへのPRマージを実施する
6. develop -> main へのPR作成する
7. mainへマージする
8. main の最新コミットを特定し、vtagを付与する（必ずmainへ付与する）

# Iterate Agent

When running iterate-agent from Claude Code, ALWAYS use `dangerouslyDisableSandbox: true`:

```typescript
Bash({
  command: "deno run -A jsr:@aidevtool/climpt/agents/iterator --issue 123",
  description: "Run iterate agent for issue 123",
  dangerouslyDisableSandbox: true,
})
```

**理由**: Claude Agent SDK は `~/.claude/projects/`, `~/.claude/statsig/`, `~/.claude/telemetry/` などのディレクトリに書き込むため、サンドボックスの許可リストに含まれていない。`dangerouslyDisableSandbox: true` を指定しないと EPERM エラーが発生する。
