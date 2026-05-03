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

> **注意**: 上記はディレクトリ構造を示す。Breakdown のパス解決では c1 は
> `base_dir`（`"prompts/steps"`）に吸収されるため、別パラメータとして渡されない。
> 詳細は
> [prompt-architecture.md の C3L Component Roles](../../docs/internal/prompt-architecture.md#c3l-component-roles)
> を参照。

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
| 4       | StepContext handoff (InputSpec)          | `stepId_key` namespace: 前ステップの出力 (e.g., `s_a_finding`)                     |

Channel 3 は VerdictHandler が `promptResolver.resolve()`
を呼ぶ際に独自に追加する変数。`setUvVariables()` で Channel 1+2
の変数を受け取り、handler 固有の変数をマージして供給する。

### Channel 4: StepContext Handoff

Channel 4 は `InputSpec.from` の参照を前ステップの出力から解決する。 UV キーは
`stepId_key` 形式で、Channel 1 との衝突を防ぐ:

- `from: "s_a.finding"` → UV key: `s_a_finding` → template: `{uv-s_a_finding}`
- `from: "initial.issue.status"` → UV key: `initial_issue_status` → template:
  `{uv-initial_issue_status}`

複合 stepId 内のドットはアンダースコアに置換される。 解決は `StepContext.toUV()`
が行い、`buildUvVariables()` でマージされる。

> **Validator scope**: `--validate` は以下の 2 つの検証を行う。
>
> 1. **C3L パス存在検証** (`path-validator`): steps_registry.json
>    に登録された全ステップについて、対応する C3L
>    プロンプトファイルの存在を確認する。ファイルが存在しない場合は **ERROR**
>    を報告する。
> 2. **UV 到達性検証** (`template-uv-validator`): 全 4 Channel の供給源を
>    静的に検証する。C3L ファイルが存在しない場合は UV チェックをスキップし
>    **WARNING** を出力する。
>    - **Channel 1** (CLI parameters): パラメータの必須/デフォルト値を検証
>    - **Channel 2/3** (runtime): `RUNTIME_SUPPLIED_UV_VARS` に含まれる変数は
>      供給済みとみなしスキップ。ただし `CONTINUATION_ONLY_UV_VARS` が
>      `initial.*` ステップで宣言されている場合は **ERROR** (実行時に未設定)
>    - **Channel 4** (step handoff): `inputs` から導出される UV 名と照合
>    - いずれの Channel にも該当しない変数は **ERROR** (供給源なし)

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
2. C3L パスを構築
3. ファイルを読み込み → 不在時は PR-C3L-004 エラー
4. UV 変数を展開
5. 結果を返す
```

C3L が唯一の解決パスである。フォールバックは存在しない。 C3L
ファイルが見つからない場合は常に `PR-C3L-004` エラーとなる。
