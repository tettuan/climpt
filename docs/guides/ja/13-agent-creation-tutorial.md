[English](../en/13-agent-creation-tutorial.md) |
[日本語](../ja/13-agent-creation-tutorial.md)

# 13. Agent 作成チュートリアル

このチュートリアルでは、Agent をゼロから作成する手順を解説します。最終的に
`deno task agent` で動作する Agent が完成します。

---

## 13.1 前提知識

**基本概念:** **Agent**
は設定（`agent.json`）とプロンプト（Markdown）で定義される
自律タスク実行の単位です。**Agent Runner**
はすべてのエージェントを実行する共通の実行エンジンです。**Verdict**
はエージェントの停止条件を決定します。詳細は
[00-1-concepts.md](./00-1-concepts.md) を参照してください。

**セットアップ:** Climpt がインストール・初期化済みであること。まだの場合は
[02-climpt-setup.md](./02-climpt-setup.md) を参照してください。

---

## 13.2 最初の Agent を作る：ステップバイステップ

最もシンプルな Agent を作成します。`count:iteration` verdict
タイプを使い、固定回数のイテレーションで停止します。

### Step 1: ディレクトリ構造の作成

```bash
mkdir -p .agent/my-first-agent/prompts
```

プロジェクトに以下の構造が作成されます：

```
.agent/my-first-agent/
├── prompts/        （まだ空）
└── (agent.json)    （Step 2 で作成）
```

### Step 2: agent.json の最小構成

`.agent/my-first-agent/agent.json` を以下の内容で作成します：

```json
{
  "$schema": "../../agents/schemas/agent.schema.json",
  "name": "my-first-agent",
  "displayName": "My First Agent",
  "description": "A simple agent that runs a fixed number of iterations",
  "version": "1.13.0",
  "parameters": {},
  "runner": {
    "flow": {
      "systemPromptPath": "prompts/system.md"
    },
    "verdict": {
      "type": "count:iteration",
      "config": {
        "maxIterations": 3
      }
    },
    "boundaries": {
      "allowedTools": ["Read", "Glob", "Grep"],
      "permissionMode": "plan"
    },
    "logging": {
      "directory": "tmp/logs/agents/my-first-agent",
      "format": "jsonl"
    }
  }
}
```

**各フィールドの説明：**

| フィールド                     | 役割                                                           |
| ------------------------------ | -------------------------------------------------------------- |
| `$schema`                      | IDE バリデーションを有効化。パスは `.agent/{name}/` からの相対 |
| `name`                         | Agent の識別子。小文字ケバブケースで記述                       |
| `displayName`                  | ログに表示される人間可読な名前                                 |
| `description`                  | この Agent が何をするか                                        |
| `version`                      | スキーマバージョン（semver）                                   |
| `parameters`                   | Agent が受け取る CLI パラメータ（ここでは空）                  |
| `runner.flow.systemPromptPath` | システムプロンプトのパス（`.agent/{name}/` からの相対）        |
| `runner.verdict.type`          | 停止条件：3 イテレーション後に終了                             |
| `runner.boundaries`            | ツール制限とパーミッションモード                               |
| `runner.logging`               | ログの出力先とフォーマット                                     |

全フィールドの詳細は [11-runner-reference.md](./11-runner-reference.md)
を参照してください。

### Step 3: システムプロンプトの作成

`.agent/my-first-agent/prompts/system.md` を作成します：

```markdown
# My First Agent

You are a simple agent. Your job is to explore the current project and summarize
what you find.

## Guidelines

- Read files to understand the project structure
- Report your findings clearly
- You have 3 iterations to complete your work
```

ディレクトリ構造は以下のようになります：

```
.agent/my-first-agent/
├── agent.json
└── prompts/
    └── system.md
```

### Step 4: --validate で検証

```bash
deno task agent --agent my-first-agent --validate
```

成功時の期待出力：

```
Validating agent: my-first-agent
  ✓ agent.json -- Schema valid
  ✓ agent.json -- Configuration valid

Validation passed.
```

バリデーションが失敗した場合、どのフィールドにエラーがあるかが表示されます。
実行前に修正してください。

### Step 5: 実行

```bash
deno task agent --agent my-first-agent
```

期待出力：

```
Loading agent: my-first-agent
  My First Agent: A simple agent that runs a fixed number of iterations

Starting My First Agent...

...agent が 3 イテレーション実行...

============================================================
Agent completed: SUCCESS
Total iterations: 3
Reason: Max iterations reached
============================================================
```

### Step 6: 結果の確認

ログファイルは `runner.logging.directory`
で指定したディレクトリに書き込まれます：

```bash
ls tmp/logs/agents/my-first-agent/
```

各セッションで `.jsonl` ファイルが生成されます。1 行が 1 つの JSON
オブジェクトで、各イベント（イテレーション開始、ツール呼び出し、LLM
応答など）が記録されます。

---

## 13.3 パラメータの追加

パラメータを使うと、CLI からエージェントに実行時の値を渡せます。`parameters`
オブジェクトの各エントリが CLI フラグになります。

`--target` パラメータを追加するには、`agent.json` の `parameters`
フィールドを更新します：

```json
{
  "parameters": {
    "target": {
      "type": "string",
      "description": "Directory or file to analyze",
      "required": true,
      "cli": "--target"
    }
  }
}
```

**各パラメータの必須フィールド：**

| フィールド    | 説明                                                      |
| ------------- | --------------------------------------------------------- |
| `type`        | `"string"`、`"number"`、`"boolean"`、`"array"` のいずれか |
| `description` | ヘルプ出力に表示される説明                                |
| `cli`         | CLI フラグ名（`--` で始まるケバブケース）                 |

**オプションフィールド：**

| フィールド | 説明                                 |
| ---------- | ------------------------------------ |
| `required` | `true` の場合、フラグの指定が必須    |
| `default`  | フラグが省略されたときのデフォルト値 |

パラメータ付きで実行します：

```bash
deno task agent --agent my-first-agent --target src/
```

Runner は `definition.parameters` を読み取り、各キーを CLI
フラグにマッピングして、一致した値を `runnerArgs`
としてエージェントセッションに渡します。

---

## 13.4 ステップアップ

基本的な Agent が動作したら、以下の機能強化を検討してください。

### 13.4.1 steps_registry.json の追加

steps registry はフェーズ間の明示的な遷移を定義するマルチステップフローです
（initial、continuation、verification、closure）。これがなければ、Agent
は全イテレーションで単一のシステムプロンプトを使用します。Agent ディレクトリに
`steps_registry.json` を追加し、`runner.flow.prompts.registry`
でそのパスを指定してください。

### 13.4.2 verdict type の変更

`count:iteration` は最もシンプルな verdict
ですが、他のタイプはより高度な制御を提供します。`detect:keyword` は LLM
がキーワードを出力して完了を通知できます。`detect:graph` は状態マシンによる DAG
ベースのステップ遷移を可能にします。verdict タイプの選択フローチャートは
[11-runner-reference.md 11.3.2 節](./11-runner-reference.md#113-runnerverdict)
を参照してください。

### 13.4.3 GitHub 連携の有効化

`runner.integrations.github.enabled` を `true` に設定し、verdict タイプに
`poll:state` を使用すると、GitHub Issue を監視し、Issue
がクローズまたはラベル付けされたときに停止する Agent
を作成できます。セットアップの 詳細は
[04-iterate-agent-setup.md](./04-iterate-agent-setup.md) を参照してください。

### 13.4.4 worktree の活用

`runner.execution.worktree` を有効にすると、Agent は独立した git worktree
で実行されます。自律動作中にメインの作業ツリーを
汚染することを防ぎます。設定オプションの詳細は
[11-runner-reference.md 11.7 節](./11-runner-reference.md#117-runnerexecution)
を参照してください。

---

## 13.5 完全な最小 Agent テンプレート

コピペで使える最小構成の Agent テンプレートです。

**ディレクトリ構造：**

```
.agent/my-agent/
├── agent.json
└── prompts/
    └── system.md
```

**`.agent/my-agent/agent.json`：**

```json
{
  "$schema": "../../agents/schemas/agent.schema.json",
  "name": "my-agent",
  "displayName": "My Agent",
  "description": "Describe what this agent does",
  "version": "1.13.0",
  "parameters": {
    "topic": {
      "type": "string",
      "description": "Topic for the session",
      "required": true,
      "cli": "--topic"
    }
  },
  "runner": {
    "flow": {
      "systemPromptPath": "prompts/system.md"
    },
    "verdict": {
      "type": "count:iteration",
      "config": {
        "maxIterations": 5
      }
    },
    "boundaries": {
      "allowedTools": ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      "permissionMode": "acceptEdits"
    },
    "logging": {
      "directory": "tmp/logs/agents/my-agent",
      "format": "jsonl"
    }
  }
}
```

**`.agent/my-agent/prompts/system.md`：**

```markdown
# My Agent

You are operating as the **my-agent** agent.

## Task

Work on the given topic thoroughly.

## Guidelines

- Think step by step
- Report progress at each iteration
- Use the available tools to read and modify files
```

**検証と実行：**

```bash
deno task agent --agent my-agent --validate
deno task agent --agent my-agent --topic "Your topic here"
```

**代替手段 -- `--init` で自動スキャフォールド：**

```bash
deno task agent --init --agent my-agent
```

このコマンドで `agent.json`、`steps_registry.json`、システムプロンプト、
ステッププロンプト、breakdown 設定ファイルが生成されます。生成されたファイルを
編集して、用途に合わせてカスタマイズしてください。

---

## 関連ドキュメント

- [00-1-concepts.md](./00-1-concepts.md) -- Agent、Runner、Verdict の基本概念
- [11-runner-reference.md](./11-runner-reference.md) -- `runner.*`
  フィールドの完全リファレンス
- [04-iterate-agent-setup.md](./04-iterate-agent-setup.md) -- GitHub Issue
  駆動の Agent セットアップ
- [05-architecture.md](./05-architecture.md) -- ランタイムアーキテクチャ概要
