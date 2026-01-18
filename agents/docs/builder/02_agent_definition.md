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
  "behavior": { "..." },
  "parameters": { "..." },
  "prompts": { "..." },
  "logging": { "..." }
}
```

## behavior

Agent の振る舞い。

```json
{
  "behavior": {
    "systemPromptPath": "prompts/system.md",
    "completionType": "externalState | iterationBudget | keywordSignal | composite",
    "completionConfig": { "..." },
    "allowedTools": ["Read", "Write", "Edit", "Bash"],
    "permissionMode": "plan | acceptEdits | bypassPermissions"
  }
}
```

### completionType

| タイプ             | What                                      | Why                                                       | 主な設定                                   |
| ------------------ | ----------------------------------------- | --------------------------------------------------------- | ------------------------------------------ |
| `externalState`    | Issue や git 等の外部状態と同期           | 1 Issue = 1 Branch = 1 Worktree の境界を守るため          | `validators`, `github`, `worktree`         |
| `iterationBudget`  | 所定回数の iteration で終了               | ループを有限に保ち暴走を防ぐ                              | `maxIterations`                            |
| `checkBudget`      | Status check の回数で終了                 | 監視用途で「回数 = コスト」を明示し、作業計画を単純化     | `maxChecks`                                |
| `keywordSignal`    | 指定キーワードを Structured Output で出す | LLM の宣言を Completion Loop へ透過させる                 | `completionKeyword`                        |
| `structuredSignal` | JSON schema で完了宣言を受け取る          | フリーテキスト依存を無くし、FormatValidator で収束を担保  | `responseFormat`, `outputSchema`           |
| `stepMachine`      | 事前に定義した step graph で判定          | Flow ループの遷移と Completion 判定を同じ図面で語れるため | `steps_registry.json`                      |
| `composite`        | 複数条件 (any/all) の合成                 | 高凝集のまま複雑な契約を表現し、AI の局所最適を減らす     | `completionConditions`, `mode`             |
| `custom`           | 外部 CompletionHandler で任意判定         | 特殊案件を外付けストラテジに押し出し、コアを汚さない      | カスタム factory, `completionHandler` 設定 |

### completionConditions

steps_registry.json で完了条件を定義する。詳細は
`design/03_structured_outputs.md` を参照。

```json
{
  "steps": {
    "closure.issue": {
      "completionConditions": [
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

## parameters

CLI 引数の定義。

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

## prompts

プロンプト解決の設定。

```json
{
  "prompts": {
    "registry": "steps_registry.json",
    "fallbackDir": "prompts/"
  }
}
```

## logging

ログ設定。

```json
{
  "logging": {
    "directory": "tmp/logs/agents/{name}",
    "format": "jsonl"
  }
}
```

## オプション

### github / worktree

外部連携（省略可）。`agents/scripts/run-agent.ts` が worktree の生成と
`--branch` / `--base-branch` を既に解決しており、Issue ごとに
孤立した作業空間を用意できる。

```json
{
  "github": { "enabled": true },
  "worktree": {
    "enabled": true,
    "root": ".worktrees"
  }
}
```

### finalize

Flow ループ完了後のワークツリー処理を制御する。`finalizeWorktreeBranch`
シーケンス（merge → push → PR → cleanup）の挙動を定義する。

```json
{
  "finalize": {
    "autoMerge": true,
    "push": false,
    "remote": "origin",
    "createPr": false,
    "prTarget": "main"
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
- completionConfig と completionType の整合性
- 参照ファイルの存在
- completionConditions の validator 参照の妥当性
```
