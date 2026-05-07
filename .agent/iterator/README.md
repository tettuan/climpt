# .agent/iterator

Iterator Agent のプロンプト外部化設定。

## 概要

Iterator Agent は `kind:impl` ラベルが付いた GitHub Issue を 1 件ずつ end-to-end で実装するエージェント。`closure.issue` に到達する前に 6 ステップの precheck チェーンを通り、commit binding (RC2/RC3) / kind boundary scope (RC6) / Acceptance Criteria coverage (RC5) を検証する。

プロンプトは `.agent/iterator/prompts/` に外部化され、`steps_registry.json` 経由で解決される。

## 設計意図

### iterator agent から見た視点

1. **climpt 標準機能の活用**: `agents/iterator` が独自のプロンプト実行を持たず、climpt の標準機能から呼び出す
2. **独立した定義**: climpt 本体と混在しないよう、iterator 専用の agent 定義を分離
3. **値置換の委譲**: 独自の変数置換を実装せず、climpt (breakdown) の uv- システムを利用

### climpt から見た視点

- `climpt-<c1> <c2> <c3>` とは分離した `iterator-<c1> <c2> <c3>` として、C3L の体系に基づいて設計

## 起動

`--issue <N>` で対象 Issue を 1 件指定する per-issue dispatch のみ。verdict type は `poll:state` 単独。

```bash
deno task agent --agent iterator --issue 123
```

worktree 実行が有効 (`runner.execution.worktree.enabled: true`)。`--branch` / `--base-branch` で worktree のブランチ名と merge target を指定できる。

## ディレクトリ構成

```
.agent/iterator/
├── README.md              # このファイル
├── agent.json             # エージェント設定
├── config.json            # ランタイム設定
├── registry.json          # C3L コマンド登録情報
├── steps_registry.json    # ステップ定義 (プロンプト解決用)
├── frontmatter-to-schema/ # スキーマ生成テンプレート
└── prompts/
    ├── system.md          # システムプロンプト
    ├── dev/               # 開発用プロンプト
    └── steps/
        ├── initial/issue/      # 初期フェーズ
        ├── continuation/issue/ # 継続フェーズ
        ├── closure/issue/      # 終端 + precheck チェーン
        └── retry/issue/        # failurePattern 別 adaptation
```

## ステップ一覧

| Step ID | 種別 | 役割 |
|---------|------|------|
| `initial.issue` | work | Issue 処理開始。要件解析と着手宣言 |
| `continuation.issue` | work | 実装ループ。`handoff` 遷移で precheck チェーンへ |
| `closure.issue.precheck-commit-list` | verification | RC2 S1: in-run commit (`(#<issue>)`) 列挙 |
| `closure.issue.precheck-commit-exists` | verification | RC2 S2a: per-SHA existence + capture changed_paths |
| `closure.issue.precheck-commit-in-run` | verification | RC3: per-SHA off-run flag (`git merge-base --is-ancestor`) |
| `closure.issue.precheck-kind-read` | verification | `kind_at_triage` 監査値読み取り (audit-only) |
| `closure.issue.precheck-kind-scope` | verification | RC6: 変更パスが kind:* スコープ内か検証 |
| `closure.issue.precheck-ac-extract` | verification | RC5 S1: Issue 本文から AC 箇条書きを抽出 |
| `closure.issue.precheck-ac-map` | verification | RC5 S2: AC ごとに changed_paths を evidence マップ化 |
| `closure.issue.precheck-ac-evidence-nonempty` | verification | RC5 S3a: 全 AC が ≥1 evidence_path を持つか検証 |
| `closure.issue.precheck-ac-typed-prefix` | verification | RC5 S3b: typed AC が prefix と `ls` を満たすか検証 |
| `closure.issue` | closure | 終端ステップ。closure action を確定 |

`entryStepMapping`: `poll:state` のみ (`initial.issue` / `continuation.issue`)。

## バリデーション

`steps_registry.json#validators` は全て `phase: "postllm"` の `command` 型。LLM 出力を受領した後に shell コマンドの exit code / stdout を判定し、失敗パターンへ遷移させる。

`validationSteps` でステップに紐づくのは以下の 3 つ。

| Step | Validator | RC |
|------|-----------|-----|
| `closure.issue.precheck-commit-exists` | `commit-binding-nonempty` | RC2 |
| `closure.issue.precheck-commit-in-run` | `commit-in-run` | RC3 |
| `closure.issue.precheck-kind-scope` | `kind-boundary-clean` | RC6 |
| `closure.issue.precheck-ac-evidence-nonempty` | `ac-evidence-nonempty` | RC5 S3a |
| `closure.issue.precheck-ac-typed-prefix` | `ac-typed-prefix-ok` | RC5 S3b |

`onFailure.action: "retry"`, `maxAttempts: 3`。

## 失敗パターンと recovery

`failurePatterns` に 13 種が登録されている (git-dirty / test-failed / type-error / lint-error / format-error / file-not-exists / branch-not-pushed / branch-not-merged / commit-binding-missing / off-run-only / ac-evidence-missing / ac-typed-prefix-violated / kind-boundary-breach)。各パターンは `prompts/steps/retry/issue/f_failed_<adaptation>.md` の adaptation file に解決され、リトライ時にそのファイルが LLM へ渡される。

## 変数置換

プロンプトは breakdown の uv- システムで変数展開する。

| 変数 | 用途 |
|-----|------|
| `{uv-issue}` | 対象 Issue 番号 (`--issue` から) |
| `{uv-completed_iterations}` | 完了済みイテレーション数 |
| `{issue_content}` | gh で取得した Issue 本文 |
| `{cross_repo_note}` | クロスリポジトリ注意書き |
| `{input_text}` | STDIN からの入力 (該当ステップのみ) |

ステップ間の handoff は `structuredGate.handoffFields` 経由で `run_started_sha` / `commit_list` / `commit_verification` / `kind_boundary_violations` / `ac_list` / `ac_mapping` / `ac_evidence_all_nonempty` / `missing_ac_ids` / `ac_typed_all_ok` / `violating_ac_ids` を受け渡す。

## Closure

`agent.json#runner.integrations.github.defaultClosureAction` で完了時動作を指定する。

| 値 | 動作 |
|----|------|
| `close` | Issue をクローズ |
| `label-only` | ラベル変更のみ、Issue は OPEN のまま (現行デフォルト) |
| `label-and-close` | ラベル変更後にクローズ |

LLM が structured output で `closure.action` を返した場合はそちらが優先される。優先順位: AI structured output > agent.json 設定 > デフォルト値。

## カスタマイズ

プロンプトを差し替える手順:

1. `steps_registry.json` で対象 Step ID を確認
2. `address` (c1/c2/c3/edition) からファイルパスを導出 (`{c1}/{c2}/{c3}/f_{edition}.md`)
3. UV 変数を使って動的コンテンツを挿入

## 参照

- プロンプトカスタマイズ: [docs/prompt-customization-guide.md](../../docs/prompt-customization-guide.md)
- アーキテクチャ: [docs/internal/prompt-architecture.md](../../docs/internal/prompt-architecture.md)
- Iterator 設計: [docs/internal/iterate-agent-design.md](../../docs/internal/iterate-agent-design.md)
- C3L 統合: [docs/internal/iterate-agent-c3l-integration.md](../../docs/internal/iterate-agent-c3l-integration.md)
