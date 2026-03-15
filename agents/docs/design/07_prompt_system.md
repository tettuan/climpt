# プロンプトシステム

Climpt の C3L 構造でプロンプトを管理し、UV 変数で動的に展開する。

## 契約

```
resolve(stepId, variables) → string | Error

入力:    ステップ ID、UV 変数
出力:    解決済みプロンプト文字列
副作用:  ファイル読み込み
エラー:  NotFound（ファイル不存在）
保証:    空文字は返さない
```

## C3L 構造

Category / Classification / Chapter でプロンプトを整理。

```
prompts/{c1}/{c2}/{c3}/f_{edition}.md

例:
prompts/steps/initial/issue/f_default.md
prompts/steps/continuation/manual/f_detailed.md
```

### ディレクトリ構造

```
.agent/{agent-name}/
└── prompts/
    ├── system.md
    └── steps/                # c1 = "steps"
        ├── initial/          # c2 = "initial"
        │   ├── issue/        # c3 = "issue"
        │   │   └── f_default.md
        │   ├── iterate/
        │   │   └── f_default.md
        │   └── manual/
        │       └── f_default.md
        └── continuation/     # c2 = "continuation"
            ├── issue/
            │   └── f_default.md
            └── ...
```

## steps_registry.json

ステップ ID と C3L パスのマッピング。

```json
{
  "version": "1.0.0",
  "basePath": "prompts",
  "steps": {
    "system": {
      "name": "システムプロンプト",
      "path": "system.md",
      "variables": ["uv-agent_name", "uv-completion_criteria"]
    },
    "initial_issue": {
      "name": "Issue 初期プロンプト",
      "c1": "steps",
      "c2": "initial",
      "c3": "issue",
      "edition": "default",
      "variables": ["uv-issue"]
    },
    "continuation_issue": {
      "name": "Issue 継続プロンプト",
      "c1": "steps",
      "c2": "continuation",
      "c3": "issue",
      "edition": "default",
      "variables": ["uv-iteration", "uv-issue"]
    }
  }
}
```

## UV 変数

User Variable。プロンプト内で `{uv-xxx}` で参照。

| 変数                      | 説明             | 供給元                      |
| ------------------------- | ---------------- | --------------------------- |
| `uv-agent_name`           | Agent 識別子     | CLI parameter               |
| `uv-completion_criteria`  | 完了条件テキスト | CLI parameter               |
| `uv-issue`                | Issue 番号       | CLI parameter               |
| `uv-iteration`            | 現在の回数       | Runner (Channel 2)          |
| `uv-completed_iterations` | 完了済み回数     | Runner (Channel 2)          |
| `uv-max_iterations`       | 最大回数         | Verdict Handler (Channel 3) |
| `uv-completion_keyword`   | 完了キーワード   | Runner (Channel 2)          |
| `uv-remaining`            | 残り回数         | Verdict Handler (Channel 3) |
| `uv-previous_summary`     | 前回のサマリー   | Verdict Handler (Channel 3) |
| `uv-check_count`          | 確認回数         | Verdict Handler (Channel 3) |
| `uv-max_checks`           | 最大確認回数     | Verdict Handler (Channel 3) |

### UV 変数の供給チャネル

| Channel | 供給元                                   | 変数                                                                               |
| ------- | ---------------------------------------- | ---------------------------------------------------------------------------------- |
| 1       | CLI parameters (agent.json)              | agent.json の parameters に宣言された全変数                                        |
| 2       | Runner runtime (buildUvVariables)        | iteration, completed_iterations, completion_keyword                                |
| 3       | VerdictHandler (buildContinuationPrompt) | handler 固有。remaining, previous_summary, max_iterations, check_count, max_checks |

Channel 3 は VerdictHandler が `promptResolver.resolve()`
を呼ぶ際に独自に追加する変数。`setUvVariables()` で Channel 1+2
の変数を受け取り、handler 固有の変数をマージして供給する。

## プロンプトテンプレート

### system.md

```markdown
# {uv-agent_name} Agent

## 完了条件

{uv-completion_criteria}

## ガイドライン

- 段階的に思考する
- 定期的に進捗を報告する
- 完了条件に従う
```

### initial/issue/f_default.md

```markdown
# Issue #{uv-issue} 対応開始

Issue の内容を確認し、作業を開始してください。 完了したら Issue
をクローズしてください。
```

## Edition

同一ステップの異なるバリエーション。

```
f_default.md   # 標準
f_detailed.md  # 詳細
f_brief.md     # 簡潔
```

steps_registry.json で `edition` を指定。

## 解決フロー

```
1. ステップ ID で registry を検索
2. C3L パスを構築（または直接パス）
3. ファイルを読み込み
4. UV 変数を展開
5. 結果を返す
```
