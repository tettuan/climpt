[English](../en/04-iterate-agent-setup.md) |
[日本語](../ja/04-iterate-agent-setup.md)

# 4. Iterate Agent の設定と実行

GitHub Issue や Project を自動的に処理する Iterate Agent を設定し、実行します。

## 4.1 Iterate Agent とは

Iterate Agent は Claude Agent SDK を使用した自律型開発エージェントです。
以下のサイクルを自動的に繰り返します：

1. GitHub Issue/Project から要件を取得
2. delegate-climpt-agent Skill でタスクを実行
3. サブエージェントが開発作業を実施
4. 結果を評価し、完了条件をチェック
5. 未完了なら次のタスクを決定して 2 へ戻る。完了なら終了。

### 主な特徴

- **自律実行**: 人間の介入なしに動作
- **GitHub 統合**: `gh` CLI を通じて Issue/Project と連携
- **Climpt Skills 統合**: 既存の Climpt インフラストラクチャを活用
- **詳細ログ**: JSONL 形式、自動ローテーション（最大100ファイル）
- **柔軟な完了条件**: Issue クローズ、Project 完了、イテレーション数

---

## 4.2 前提条件

**重要**: Iterate Agent を使用する前に、以下のセットアップが必要です：

| 要件                   | 確認方法                       |
| ---------------------- | ------------------------------ |
| **GitHub CLI (`gh`)**  | `gh auth status`               |
| **Git リポジトリ**     | `git status`                   |
| **GitHub リモート**    | `git remote -v`                |
| **対象 Issue/Project** | `gh issue list`                |
| **Claude Code Plugin** | `.claude/settings.json` を確認 |

### セットアップの確認

```bash
gh auth status
git status
git remote -v
gh issue list
```

### 初期化は必須

Iterate Agent を実行する前に、**必ず**初期化コマンドを実行してください：

```bash
deno run -A jsr:@aidevtool/climpt/agents/iterator --init
```

---

## 4.3 初期化

```bash
cd your-project
deno run -A jsr:@aidevtool/climpt/agents/iterator --init
```

### 作成されるファイル

```
your-project/
├── agents/iterator/
│   └── config.json           # メイン設定
├── .agent/iterator/
│   └── prompts/dev/          # システムプロンプト（C3L形式）
└── tmp/
    └── logs/
        └── agents/           # 実行ログ（自動作成）
```

---

## 4.4 基本的な使い方

### Issue ベースの実行

指定した Issue がクローズされるまで自動実行（`-i` で短縮可）：

```bash
deno run -A jsr:@aidevtool/climpt/agents/iterator --issue 123
```

### Project ベースの実行

Project 内のすべてのアイテムが完了するまで実行（`-p` で短縮可）：

```bash
deno run -A jsr:@aidevtool/climpt/agents/iterator --project 5
```

### イテレーション数を制限

最大10回のイテレーションで停止（`-m` で短縮可）：

```bash
deno run -A jsr:@aidevtool/climpt/agents/iterator --iterate-max 10
```

### セッションの再開

```bash
deno run -A jsr:@aidevtool/climpt/agents/iterator --issue 123 --resume
```

### オプション一覧

| オプション        | 短縮形 | デフォルト       | 説明                                       |
| ----------------- | ------ | ---------------- | ------------------------------------------ |
| `--init`          | -      | -                | 設定ファイルを初期化                       |
| `--issue`         | `-i`   | -                | 対象の GitHub Issue 番号                   |
| `--project`       | `-p`   | -                | 対象の GitHub Project 番号                 |
| `--iterate-max`   | `-m`   | Infinity         | 最大イテレーション数                       |
| `--name`          | `-n`   | `climpt`         | エージェント名                             |
| `--project-owner` | `-o`   | リポジトリ所有者 | プロジェクト所有者（--project 使用時のみ） |
| `--resume`        | `-r`   | false            | 前回セッションを再開                       |
| `--help`          | `-h`   | -                | ヘルプを表示                               |

---

## 4.5 完了条件

| モード          | 完了条件                                              | チェック方法                    |
| --------------- | ----------------------------------------------------- | ------------------------------- |
| `--issue`       | Issue がクローズ（`label-only` 設定時はフェーズ完了） | `gh issue view --json state`    |
| `--project`     | 全アイテムが完了                                      | `gh project view --format json` |
| `--iterate-max` | 指定回数に到達                                        | 内部カウンター                  |

### 組み合わせ

複数の条件を組み合わせることも可能：

```bash
# Issue #123 がクローズされるか、10回のイテレーションで停止
deno run -A jsr:@aidevtool/climpt/agents/iterator --issue 123 --iterate-max 10

# 別のユーザー/組織が所有するプロジェクトで作業
deno run -A jsr:@aidevtool/climpt/agents/iterator --project 5 --project-owner my-org
```

---

## 4.6 設定のカスタマイズ

### config.json

```json
{
  "version": "1.0.0",
  "agents": {
    "climpt": {
      "allowedTools": [
        "Skill",
        "Read",
        "Write",
        "Edit",
        "Bash",
        "Glob",
        "Grep"
      ],
      "permissionMode": "acceptEdits"
    }
  },
  "github": {
    "apiVersion": "2022-11-28"
  },
  "logging": {
    "directory": "tmp/logs/agents",
    "maxFiles": 100,
    "format": "jsonl"
  }
}
```

### 設定項目の説明

| 項目                | 説明                                 |
| ------------------- | ------------------------------------ |
| `allowedTools`      | 使用可能なツールのリスト             |
| `permissionMode`    | 権限モード                           |
| `logging.directory` | ログ出力先                           |
| `logging.maxFiles`  | ログファイル最大数（ローテーション） |

### allowedTools の動作

`allowedTools`
はエージェントが使用できるツールを制限する**主要なメカニズム**です。
ここにリストされたツールのみが実行時に Claude に公開されます。

**重要な注意点:**

- SDK init メッセージには登録済み全ツール（22
  個以上）が表示されるが、`allowedTools`
  による制限はツール使用時に適用される（初期化時ではない）
- Climpt エージェントは `filterAllowedTools()`
  による追加のステップ種別フィルタを 適用する — boundary ツール（例:
  `githubIssueClose`）は work/verification ステップで自動的に除外される
- ツール制限を構造的に保証するには、`permissionMode` だけに頼らず `allowedTools`
  を明示的に定義すること

SDK の権限モードについて詳細は
[Configure permissions](../../reference/sdk/permissions.md#permission-modes)
を参照。

### permissionMode の種類

| モード              | 説明                                 | 推奨用途             |
| ------------------- | ------------------------------------ | -------------------- |
| `default`           | すべての操作に確認が必要             | 初回テスト           |
| `plan`              | プランニングモード（ツール実行なし） | 計画確認             |
| `acceptEdits`       | ファイル編集を自動承認               | **通常運用（推奨）** |
| `bypassPermissions` | すべての操作を自動承認               | 完全自動化           |

### システムプロンプトのカスタマイズ

システムプロンプトは `.agent/iterator/prompts/dev/`
にC3L形式で配置されています：

| ファイル                      | 用途                           |
| ----------------------------- | ------------------------------ |
| `start/default/f_default.md`  | イテレーション回数ベースモード |
| `start/issue/f_default.md`    | 単一GitHub Issueモード         |
| `start/project/f_default.md`  | GitHub Project準備モード       |
| `review/project/f_default.md` | プロジェクト完了レビューモード |

これらのプロンプトはUV変数を使用して動的にコンテンツを挿入します（例：`{uv-agent_name}`,
`{uv-completion_criteria}`）。

デフォルトの system.md テンプレートには `{uv-completion_criteria}`
が含まれており、実行時に CompletionHandler
の値で自動的に展開されます。独自の完了条件を定義したい場合は、`{uv-completion_criteria}`
を使わずに system.md に直接記述してください。

### `claude_code` プリセット

Agent SDK はデフォルトで**空のシステムプロンプト**を使用します。Claude Code
の完全なシステムプロンプトを使用するには、`claude_code` プリセットを指定します：

```json
{
  "agents": {
    "climpt": {
      "systemPrompt": {
        "type": "preset",
        "preset": "claude_code",
        "append": "プリセットプロンプトの後に追加するカスタム指示。"
      }
    }
  }
}
```

**重要なポイント:**

- プリセットはツール使用指示、コードガイドライン、git
  プロトコル、環境コンテキストを提供する —
  これがないとエージェントは最小限のガイダンスで動作する
- プリセットは CLAUDE.md ファイルを**自動的にはロードしない** —
  プロジェクトレベルの指示をロードするには `settingSources: ["project"]`
  を別途設定する必要がある
- `append`
  を使用すると、組み込み機能をすべて保持したままカスタム指示を追加できる

| シナリオ                     | 設定                           |
| :--------------------------- | :----------------------------- |
| Claude Code 風のエージェント | `claude_code` プリセットを使用 |
| ゼロからカスタム動作         | カスタム `systemPrompt` 文字列 |
| Claude Code の動作を拡張     | プリセット + `append`          |
| 最小限/組み込みエージェント  | プリセット省略（空プロンプト） |

詳細は
[Modifying system prompts](../../reference/sdk/modifying-system-prompts.md#understanding-system-prompts)
を参照。

### --agent オプションについて

`--agent` は `registry_config.json` で定義されたレジストリ名を指定します：

```json
// .agent/climpt/config/registry_config.json
{
  "registries": {
    "climpt": ".agent/climpt/registry.json",
    "iterator": ".agent/iterator/registry.json"
  }
}
```

| --agent 値 | 使用されるレジストリ            |
| ---------- | ------------------------------- |
| `climpt`   | `.agent/climpt/registry.json`   |
| `iterator` | `.agent/iterator/registry.json` |

---

## 4.7 実行レポート

実行完了時に、詳細なレポートが表示されます。

### Performance

| 指標           | 値             | ソース               |
| -------------- | -------------- | -------------------- |
| 総実行時間     | 328秒 (~5.5分) | SDK `duration_ms`    |
| API時間        | 241秒 (~4分)   | SDK 内部             |
| ターン数       | 28             | SDK `num_turns`      |
| イテレーション | 1回            | Agent runner         |
| 総コスト       | $0.82 USD      | SDK `total_cost_usd` |

### ログファイル

ログは JSONL 形式で保存されます：

```
tmp/logs/agents/climpt/session-2025-12-31T10-00-00-000Z.jsonl
```

ログの確認：

```bash
# 最新のログを表示
cat tmp/logs/agents/climpt/session-*.jsonl | jq .

# エラーのみ抽出
cat tmp/logs/agents/climpt/session-*.jsonl | jq 'select(.level == "error")'
```

---

## 4.8 トラブルシューティング

| 問題                              | 対処                                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| `gh command not found`            | `brew install gh` → `gh auth login`。詳細は [01-prerequisites.md](./01-prerequisites.md) |
| `Configuration file not found`    | プロジェクトルートから `--init` を再実行                                                 |
| `Empty output from breakdown CLI` | `ls -la .agent/iterator/prompts/dev/` で確認、なければ `--init` を再実行                 |
| `Permission denied`               | `config.json` の `permissionMode` を確認（推奨: `acceptEdits`）                          |
| `gh auth status fails`            | `gh auth logout` → `gh auth login` で再認証                                              |
| Project が見つからない            | `gh project list --owner @me` で番号と所有者を確認                                       |
| Issue が見つからない              | `gh issue list` で番号を確認                                                             |

---

## Deno Task として登録（推奨）

頻繁に使用する場合は、`deno.json` にタスクを追加：

```json
{
  "tasks": {
    "iterate-agent": "deno run -A jsr:@aidevtool/climpt/agents/iterator"
  }
}
```

実行：

```bash
deno task iterate-agent --issue 123
deno task iterate-agent --project 5 --iterate-max 10
```

---

## サポート

問題が発生した場合は、Issue を作成してください：
https://github.com/tettuan/climpt/issues
