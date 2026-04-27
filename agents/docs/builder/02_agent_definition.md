# Agent 定義

agent.json で Agent
の振る舞いを宣言する。`docs/internal/ai-complexity-philosophy.md`
が説く「意図的な単純化」の原則に従い、What/Why を先に決めてから How
（設定値）を埋めるという姿勢を崩さない。

## 構造

```json
{
  "name": "識別子",
  "displayName": "表示名",
  "description": "説明",
  "parameters": { "..." },
  "runner": {
    "flow": { "..." },
    "verdict": { "..." },
    "boundaries": { "..." },       // optional — sandbox only
    "integrations": { "..." },
    "actions": { "..." },
    "execution": { "..." },
    "logging": { "..." }
  }
}
```

## runner.flow

フロー制御（プロンプト解決、ステップ遷移）。

```json
{
  "runner": {
    "flow": {
      "systemPromptPath": "prompts/system.md",
      "prompts": {
        "registry": "steps_registry.json"
      }
    }
  }
}
```

## runner.verdict

完了判定の戦略。

```json
{
  "runner": {
    "verdict": {
      "type": "poll:state | count:iteration | detect:keyword | meta:composite",
      "config": { "..." }
    }
  }
}
```

### verdictType

| タイプ              | What                                      | Why                                                       | 主な設定                                                           |
| ------------------- | ----------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------ |
| `poll:state`        | Issue や git 等の外部状態と同期           | 1 Issue = 1 Branch = 1 Worktree の境界を守るため          | `validators`, `github`, `worktree`, **parameters に `issue` 必須** |
| `count:iteration`   | 所定回数の iteration で終了               | ループを有限に保ち暴走を防ぐ                              | `maxIterations`                                                    |
| `count:check`       | Status check の回数で終了                 | 監視用途で「回数 = コスト」を明示し、作業計画を単純化     | `maxChecks`                                                        |
| `detect:keyword`    | 指定キーワードを structured output で出す | LLM の宣言を Completion Loop へ透過させる                 | `verdictKeyword`                                                   |
| `detect:structured` | JSON schema で完了宣言を受け取る          | フリーテキスト依存を無くし、FormatValidator で収束を担保  | `responseFormat`, `outputSchema`                                   |
| `detect:graph`      | 事前に定義した step graph で判定          | Flow ループの遷移と Completion 判定を同じ図面で語れるため | `steps_registry.json`                                              |
| `meta:composite`    | 複数条件 (any/all) の合成                 | 高凝集のまま複雑な契約を表現し、AI の局所最適を減らす     | `operator`, `conditions`                                           |
| `meta:custom`       | 外部 VerdictHandler で任意判定            | 特殊案件を外付けストラテジに押し出し、コアを汚さない      | カスタム factory, `verdictHandler` 設定                            |

### preflightConditions / postLLMConditions

Closure validation の検証条件を steps_registry.json で 2 つの slot
に分けて定義する。 `preflightConditions` は LLM
呼び出し前に評価される純粋述語（失敗時は即 abort）、 `postLLMConditions` は LLM
呼び出し後に評価され失敗時に retry prompt を生成しうる。 各 validator は
`phase: "preflight" | "postllm"` を宣言し、slot と一致する必要がある
(R-C7)。詳細は [validator-catalog.md](./validator-catalog.md) と
`design/05_structured_outputs.md` を参照。

```json
{
  "validationSteps": {
    "closure.issue": {
      "preflightConditions": [],
      "postLLMConditions": [
        { "validator": "git-clean" },
        { "validator": "tests-pass" }
      ],
      "onFailure": {
        "action": "retry",
        "maxAttempts": 3
      }
    }
  }
}
```

### Verdict 伝搬（Validator Agent）

Validator Agent（`workflow.json` で `role: "validator"` を持つ Agent）では、 AI
の structured output に含まれる `verdict` フィールドが Orchestrator の phase
遷移を決定する。

**AI の structured output 例（closure step）:**

```json
{ "intent": "closing", "verdict": "approved" }
```

**伝搬の流れ:**

1. closure step で AI が `verdict` フィールドを返す
2. BoundaryHook が structured output から verdict 値を抽出し
   `VerdictResult.verdict` に格納
3. Runner が `AgentResult.verdict` としてディスパッチャーに返す
4. ディスパッチャーが `DispatchOutcome.outcome` に verdict 値をマッピング
5. Orchestrator の `computeTransition()` が outcome を `outputPhases`
   のキーとして遷移先を解決

verdict が `outputPhases` に存在しない、または未指定の場合は `fallbackPhase`
に遷移する。

BoundaryHook は `verdict` に加えて、structured output の `issue.labels.add` /
`issue.labels.remove` からラベル変更指示も読み取る。これにより
`github.labels.completion` 設定を AI 出力で動的に上書きできる。

詳細: [design/12_orchestrator.md](../design/12_orchestrator.md)

## runner.boundaries

サンドボックス（セキュリティポリシー）のみ。`allowedTools` と `permissionMode`
は `.agent/climpt/config/claude.settings.climpt.agents.{agent-name}.json`
（無ければ `.agent/climpt/config/claude.settings.climpt.agents.json`）の
`permissions.allow` / `permissions.defaultMode` に移動した。

```json
{
  "runner": {
    "boundaries": {
      "sandbox": { "enabled": true }
    }
  }
}
```

`boundaries` 自体はオプション。sandbox 未指定なら省略可。

### サンドボックスと GitHub アクセス制御

サンドボックスは **決定論的なネットワーク遮断** により、Agent の GitHub
アクセスを制御する。

| 設定項目                   | デフォルト値             | 設計意図                                                                      |
| -------------------------- | ------------------------ | ----------------------------------------------------------------------------- |
| `trustedDomains`           | GitHub ドメイン **除外** | Agent が直接 GitHub にアクセスすることを物理的に防止                          |
| `excludedCommands`         | `[]`（空）               | サンドボックスをバイパスするコマンドを一切許可しない                          |
| `allowUnsandboxedCommands` | `false`                  | モデルが `dangerouslyDisableSandbox` を実行時にリクエスト可能にするオプション |

**Agent の GitHub 読み取り** は `mcp__github__github_read` MCP ツールで行う。
このツールはホストプロセス（サンドボックス外）で `gh` コマンドを実行するため、
TLS/Keychain の制約を受けない。Runner が実行時の allowed-tools
集合に自動追加する。

**Agent の GitHub 書き込み** は BoundaryHook（closure step のみ）が担う。 Agent
は structured output で意図を宣言するだけであり、`gh` コマンドの実行は Runner の
BoundaryHook がホストプロセス内で行う。

参照: `agents/runner/sandbox-defaults.ts`, `agents/runner/github-read-tool.ts`

### runner.flow.defaultModel

使用するモデルのデフォルト値。省略時は `opus`（システムデフォルト）。
`runner.flow` 内に配置する。

| 値       | 説明                           |
| -------- | ------------------------------ |
| `opus`   | 最高性能（システムデフォルト） |
| `sonnet` | 高性能・バランス               |
| `haiku`  | 高速・低コスト                 |

**通常は設定不要**。opus がデフォルトのため、エージェント全体で異なるモデルを
使いたい場合のみ指定する。ステップごとの指定は `steps_registry.json` で行う。

詳細: [design/08_model_selection.md](../design/08_model_selection.md)

## runner.integrations

外部サービス連携設定（省略可）。

### github

GitHub 連携（省略可）。`deno task agent` が worktree の生成と `--branch` /
`--base-branch` を既に解決しており、Issue ごとに 孤立した作業空間を用意できる。

```json
{
  "runner": {
    "integrations": {
      "github": {
        "enabled": true,
        "labels": {
          "requirements": "docs",
          "inProgress": "in-progress",
          "blocked": "need clearance",
          "completion": {
            "add": ["done"],
            "remove": ["in-progress"]
          }
        },
        "defaultClosureAction": "close"
      }
    }
  }
}
```

#### github.labels.completion

Issue 完了時に自動適用するラベル設定。

| フィールド | 説明                   |
| ---------- | ---------------------- |
| `add`      | 完了時に追加するラベル |
| `remove`   | 完了時に削除するラベル |

#### github.defaultClosureAction

Issue 完了時のデフォルトアクション。AI の structured output で上書き可能。

`closure_action` の値（`close`, `label-only`,
`label-and-close`）と優先順位の詳細は
[09_closure_output_contract.md](./09_closure_output_contract.md) を参照。

> **Close binding (workflow.json 側)**: 「どの channel が close を発火するか」は
> agent.json ではなく `workflow.json` の `agents.{id}.closeBinding` で宣言する。
> 旧 `closeOnComplete` / `closeCondition` の置換であり、shape および 5 variant
> は
> [06_workflow_setup.md §「Close binding (per agent)」](./06_workflow_setup.md#close-binding-per-agent)
> を参照。

**Multi-agent ワークフローでの使い分け**

複数の Agent が連携するワークフローでは、最終 Agent 以外は `label-only`
を使用する。

```
Analyst (label-only) → Architect (label-only) → Writer (label-only) → Facilitator (close)
```

| Agent の役割 | 推奨値       | 理由                                      |
| ------------ | ------------ | ----------------------------------------- |
| 中間 Agent   | `label-only` | Issue を OPEN のまま次の Agent へ引き継ぐ |
| 最終 Agent   | `close`      | ワークフロー完了時に Issue をクローズ     |

> **注意**: デフォルト値は `close` のため、中間 Agent で明示的に `label-only` を
> 設定しないと、意図せず Issue がクローズされる。 → トラブルシューティング:
> [Issue が意図せず close される](05_troubleshooting.md#issue-が意図せず-close-される)

**Prompt 層への影響**

`defaultClosureAction` は BoundaryHook だけでなく、Prompt 生成にも反映される。

| 設定値            | `buildVerdictCriteria().short` | Prompt のクローズ指示      |
| ----------------- | ------------------------------ | -------------------------- |
| `close`           | `Close Issue #N`               | `"close it when done"`     |
| `label-only`      | `Complete phase for Issue #N`  | `"Do NOT close the issue"` |
| `label-and-close` | `Issue #N labeled and closed`  | `"close it when done"`     |

`label-only` の場合、プロンプト（`buildInitialPrompt()` /
`buildContinuationPrompt()`）も `"action":"close"` の代わりに
`"action":"complete"` を使用し、エージェントに phase 完了のみを指示する。

## runner.actions

アクション検出と実行設定（省略可）。

```json
{
  "runner": {
    "actions": {
      "enabled": true,
      "types": ["issue-action", "project-plan", "review-result"],
      "outputFormat": "json",
      "handlers": {
        "project-plan": "builtin:completion-signal"
      }
    }
  }
}
```

| フィールド     | 説明                                   |
| -------------- | -------------------------------------- |
| `enabled`      | アクション検出を有効化                 |
| `types`        | 許可するアクションタイプのリスト       |
| `outputFormat` | Markdown コードブロックマーカー形式    |
| `handlers`     | ハンドラーマッピング (type -> handler) |

## runner.execution

ワークツリーとファイナライズ設定。

### worktree

```json
{
  "runner": {
    "execution": {
      "worktree": {
        "enabled": true,
        "root": ".worktrees"
      }
    }
  }
}
```

### finalize

Flow ループ完了後のワークツリー処理を制御する。`finalizeWorktreeBranch`
シーケンス（merge → push → PR → cleanup）の挙動を定義する。

```json
{
  "runner": {
    "execution": {
      "finalize": {
        "autoMerge": true,
        "push": false,
        "remote": "origin",
        "createPr": false,
        "prTarget": "main"
      }
    }
  }
}
```

| フィールド  | デフォルト | 説明                                  |
| ----------- | ---------- | ------------------------------------- |
| `autoMerge` | `true`     | worktree ブランチをベースへ自動マージ |
| `push`      | `false`    | マージ後にリモートへプッシュ          |
| `remote`    | `"origin"` | プッシュ先のリモート                  |
| `createPr`  | `false`    | 直接マージではなく PR を作成          |
| `prTarget`  | ベース     | PR のターゲットブランチ               |

CLI オプションでオーバーライド可能:

- `--no-merge`: autoMerge を無効化
- `--push`: push を有効化
- `--push-remote <name>`: リモート指定
- `--create-pr`: PR 作成モード
- `--pr-target <branch>`: PR ターゲット指定

## runner.logging

ログ設定。

```json
{
  "runner": {
    "logging": {
      "directory": "tmp/logs/agents/{name}",
      "format": "jsonl"
    }
  }
}
```

## parameters

CLI 引数の定義。`run-agent.ts`
はここに宣言されたパラメータのみをランナーに転送する。 **宣言されていない CLI
引数は無視される。**

```json
{
  "parameters": {
    "topic": {
      "type": "string",
      "description": "セッショントピック",
      "required": true,
      "cli": "--topic"
    },
    "maxIterations": {
      "type": "number",
      "default": 10,
      "cli": "--max-iterations"
    }
  }
}
```

| フィールド    | 必須 | 説明                                                 |
| ------------- | ---- | ---------------------------------------------------- |
| `type`        | Yes  | パラメータの型 (`string`, `number` など)             |
| `description` | No   | パラメータの説明                                     |
| `required`    | No   | 必須指定。省略時は `false`（optional）として扱われる |
| `default`     | No   | デフォルト値                                         |
| `cli`         | No   | 対応する CLI オプション名                            |

> **Note**: `required` フィールドは省略可能。省略時は `false`（optional）として
> 扱われる。`required: true` を指定したパラメータのみ、CLI
> で未指定時にエラーとなる。

### verdictType 別の必須パラメータ

| verdictType  | 必須パラメータ | 説明                                      |
| ------------ | -------------- | ----------------------------------------- |
| `poll:state` | `issue`        | GitHub Issue 番号。未宣言だと実行時エラー |

`poll:state` を使う場合、以下を `parameters` に含めること:

```json
{
  "parameters": {
    "issue": {
      "type": "number",
      "description": "GitHub Issue number",
      "required": true,
      "cli": "--issue"
    }
  }
}
```

## ディレクトリ構造

```
.agent/{agent-name}/
├── agent.json
├── config.json          # 実行時設定（省略可）
├── steps_registry.json
└── prompts/
    ├── system.md
    └── steps/...        # C3L 構造
```

## 検証

起動時に検証される。

```
load(path) → parse → validate → 起動 or エラー

検証項目:
- 必須フィールドの存在
- runner.verdict.config と runner.verdict.type の整合性
- 参照ファイルの存在
- C3L プロンプトファイルの存在
- preflightConditions / postLLMConditions の validator 参照と phase の妥当性
```

---

## 注意点

| 項目                                 | 注意                                                                                                                                                                                                |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runner.verdict.type`                | 8 種類のみ有効。レガシー名は廃止済み                                                                                                                                                                |
| `runner.flow.systemPromptPath`       | agent.json からの相対パス                                                                                                                                                                           |
| `permissions.allow` (settings)       | `.agent/climpt/config/claude.settings.climpt.agents.{name}.json` で定義。許可されていないツールは `canUseTool` で hard-deny                                                                         |
| `permissions.defaultMode` (settings) | 同上 settings の `defaultMode`。`bypassPermissions` は信頼できる環境でのみ使用。ステップ単位で上書き可能（[14-steps-registry-guide](../../docs/guides/ja/14-steps-registry-guide.md) §14.4.1 参照） |

---

## 用語: iterate 関連の用語整理

コードベース内で "iterate" に関連する用語が複数存在する。混同を防ぐため
以下に整理する。

| Term              | Context        | Meaning                                                                | Location                                  |
| ----------------- | -------------- | ---------------------------------------------------------------------- | ----------------------------------------- |
| `iterator`        | Agent name     | GitHub Issue を反復的に解決する具象ビルトインエージェント              | `.agent/iterator/agent.json`              |
| `count:iteration` | Verdict type   | N 回の iteration 後に停止する完了戦略                                  | `runner.verdict.type` in agent.json       |
| `iterate`         | Entry step key | iterate モードの開始ステップを選択するエントリーステップマッピングキー | `entryStepMapping` in steps_registry.json |
| `--iterate-max`   | CLI parameter  | 最大 iteration 回数を設定する（count:iteration completion に適用）     | `definition.parameters` in agent.json     |

> **注意**: これらの用語は関連しているが、それぞれ異なる概念である。 Iterator
> Agent は具象エージェントインスタンスであり、completion type や
> 実行モードではない。`count:iteration` completion type は Iterator Agent
> に限らず、任意のエージェントで使用できる。

---

## 関連ドキュメント

| ドキュメント                                                          | 内容                                         |
| --------------------------------------------------------------------- | -------------------------------------------- |
| [01_quickstart.md](./01_quickstart.md)                                | ファイル作成手順                             |
| [03_builder_guide.md](./03_builder_guide.md)                          | 設計思想と連鎖                               |
| [04_config_system.md](./04_config_system.md)                          | 設定の優先順位                               |
| [design/05_structured_outputs.md](../design/05_structured_outputs.md) | preflight/postLLM conditions の詳細          |
| [09_closure_output_contract.md](./09_closure_output_contract.md)      | Closure Output Contract                      |
| [design/08_model_selection.md](../design/08_model_selection.md)       | モデル選択の設計                             |
| [reference/agent.yaml](./reference/agent.yaml)                        | agent.json 全フィールドリファレンス          |
| [reference/steps_registry.yaml](./reference/steps_registry.yaml)      | steps_registry.json 全フィールドリファレンス |
