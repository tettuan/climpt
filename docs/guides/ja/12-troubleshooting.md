[English](../en/12-troubleshooting.md) | [日本語](../ja/12-troubleshooting.md)

# 12. トラブルシューティングガイド

Climpt および Iterate Agent 全体のエラー診断と解決のための統合リファレンスです。

---

## クイックエラーインデックス

| エラーメッセージ / キーワード                  | セクション                                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `gh: command not found`                        | [1.2 gh CLI が見つからない](#12-gh-cli-が見つからない--認証エラー)                                            |
| `deno: command not found`                      | [1.1 Deno が見つからない](#11-deno-が見つからない--バージョン不一致)                                          |
| `Permission denied` / `EACCES` / `EPERM`       | [1.3 権限エラー](#13-権限エラー)                                                                              |
| `Configuration load failed at`                 | [2.1 設定ファイルが見つからない](#21-設定ファイルが見つからない)                                              |
| `Unknown key: runner.completion`               | [2.2 旧フォーマット警告](#22-旧フォーマット警告unknown-key)                                                   |
| `Prompt not found:`                            | [2.3 バリデーション失敗](#23-バリデーション失敗)                                                              |
| `rate limit` / `429` / `Too many requests`     | [3.1 レート制限 / API エラー](#31-レート制限--api-エラー)                                                     |
| `Cannot execute SDK query() in double sandbox` | [3.2 サンドボックス制限](#32-サンドボックス制限)                                                              |
| `Claude Code process exited with code 1`       | [3.2 サンドボックス制限](#32-サンドボックス制限) / [3.4 permissionMode の不一致](#34-permissionmode-の不一致) |
| `Empty output from breakdown CLI`              | [4.1 空出力](#41-breakdown-cli-の空出力)                                                                      |
| `FAILED_STEP_ROUTING`                          | [4.2 ステップルーティングエラー](#42-ステップルーティングエラー)                                              |
| `GATE_INTERPRETATION_ERROR`                    | [4.2 ステップルーティングエラー](#42-ステップルーティングエラー)                                              |
| `Maximum iterations (N) reached`               | [4.3 Verdict / 完了判定の失敗](#43-verdict--完了判定の失敗)                                                   |
| `C3L prompt file not found`                    | [4.4 C3L プロンプトファイルが見つからない](#44-c3l-プロンプトファイルが見つからない)                          |
| `AGENT_NOT_INITIALIZED`                        | [4.5 初期化エラー](#45-初期化エラーとワークツリーエラー)                                                      |

---

## 1. 環境エラー

### 1.1 Deno が見つからない / バージョン不一致

**症状**: `deno: command not found`、またはコマンド実行時に予期しない API
エラー。

**原因**: Deno がインストールされていない、またはバージョンが 2.5 未満。

**解決策**:

```bash
# Deno をインストール
curl -fsSL https://deno.land/install.sh | sh

# バージョンを確認（2.5 以上が必要）
deno --version
```

**予防策**: CI 設定で Deno バージョンを固定し、プロジェクトの README
に記載する。

---

### 1.2 gh CLI が見つからない / 認証エラー

**症状**: `gh: command not found`、または `gh auth status` が「not logged in」と
報告する。

**原因**: GitHub CLI がインストールされていない、または認証されていない。

**解決策**:

```bash
# インストール（macOS）
brew install gh

# 対話的に認証
gh auth login

# 確認
gh auth status
```

**予防策**: プロジェクトセットアップの一部として `gh auth status`
を実行する。[01-prerequisites.md](./01-prerequisites.md) を参照。

---

### 1.3 権限エラー

**症状**: ファイル操作やコマンド実行時に `Permission denied`、`EACCES`、または
`operation not permitted`。

**原因**: ファイルシステムの権限が不十分、またはサンドボックス制限によるアクセス
ブロック。

**解決策**:

1. ファイルの所有権と権限を確認:
   ```bash
   ls -la .agent/
   ```
2. Claude Code 内で実行している場合、サンドボックスが書き込みアクセスを制限
   している可能性がある。Bash ツール呼び出しで `dangerouslyDisableSandbox: true`
   を使用するか、外部ターミナルから実行する。

**予防策**: プロジェクトディレクトリを所有しているユーザーのターミナルから
エージェントコマンドを実行する。

---

### 1.4 ネットワーク / プロキシの問題

**症状**: `ECONNREFUSED`、`ETIMEDOUT`、`ENOTFOUND`、または `socket hang up`。

**原因**: ネットワーク接続の問題、VPN/プロキシ設定、または DNS 解決の失敗。

**解決策**:

1. ネットワーク接続を確認:
   ```bash
   curl -s https://api.anthropic.com/health
   ```
2. プロキシの背後にいる場合、`HTTPS_PROXY` を設定:
   ```bash
   export HTTPS_PROXY=http://proxy.example.com:8080
   ```
3. ランナーは一時的なネットワークエラーを指数バックオフで自動リトライする （基本
   5 秒、最大 60 秒）。

**予防策**: 長時間のエージェントセッションを開始する前に安定した接続を確保する。

---

## 2. 設定エラー

### 2.1 設定ファイルが見つからない

**症状**: `ConfigError`（コード: AC-LOAD-001 〜 AC-LOAD-003）、メッセージ
`Configuration load failed at <path>`。

**原因**:
`agent.json`、`config.json`、またはプロンプトテンプレートが存在しない。
初期化がスキップされたか、誤ったディレクトリで実行された。

**解決策**:

```bash
cd your-project
deno run -A jsr:@aidevtool/climpt/agents/iterator --init
```

**予防策**: 初回実行前に必ずプロジェクトルートから `--init` を実行する。

---

### 2.2 旧フォーマット警告（Unknown key）

**症状**: `Unknown key: runner.completion` や
`Unknown key: completionConditions` などの警告。

**原因**: v1.12.0 のキー名を使用しているが、v1.13.0 でリネームされた。

**解決策**: マイグレーションマッピングに従いキーをリネーム:

| 旧キー                 | 新キー                 |
| ---------------------- | ---------------------- |
| `runner.completion`    | `runner.verdict`       |
| `completionKeyword`    | `verdictKeyword`       |
| `completionConditions` | `validationConditions` |
| `completionSteps`      | `validationSteps`      |
| `completionPatterns`   | `failurePatterns`      |

完全なマッピングは [09-migration-guide.md](./09-migration-guide.md) を参照。

**予防策**: 設定ファイル編集後に `--validate` を実行する。

---

### 2.3 バリデーション失敗

**症状**: `ConfigError`（コード: PR-FILE-001）（`Prompt not found: <path>`）、
必須フィールドの欠落、または `permissionMode` や `runner.verdict.type` の enum
値が範囲外。

**原因**: 設定にタイプミス、必須フィールドの欠落、または許可された値セット外の
値が含まれている。

**解決策**:

1. バリデーションコマンドを実行:
   ```bash
   deno task agent --agent <name> --validate
   ```
2. enum 値をリファレンスと照合:
   - `permissionMode`: `default`, `plan`, `acceptEdits`, `bypassPermissions`
   - `runner.verdict.type`: `detect:keyword`, `count:iteration`, `poll:state`,
     `detect:graph`, `meta:custom`

**予防策**: 実行前に常にバリデーション:
`deno task agent --agent <name> --validate`。

---

### 2.4 スキーマバリデーションエラー

**症状**: ログに `SchemaPointerError` または `MalformedSchemaIdentifierError`。

**原因**: `steps_registry.json` の `outputSchemaRef`
が存在しないポインタを参照している、または不正な JSON Pointer
構文を使用している。

**解決策**:

1. スキーマファイルが `.agent/{agentId}/schemas`
   ディレクトリ内に存在することを確認。
2. `outputSchemaRef` がオブジェクト形式であることを確認:
   ```json
   {
     "outputSchemaRef": {
       "file": "step-output.schema.json",
       "schema": "initial.assess"
     }
   }
   ```
3. `schema` キーがスキーマファイルの `definitions`
   セクションに存在することを確認。

**予防策**: 標準的な JSON Pointer
形式（`"#/definitions/stepId"`）を使用し、スキーマファイルが有効な JSON
であることを検証する。

---

## 3. 実行時エラー

### 3.1 レート制限 / API エラー

**症状**: `rate limit`、`429`、`Too many requests`、または
`You've hit your limit` を含むメッセージ。

**原因**: Anthropic API のレート制限に到達した。

**解決策**:

ランナーはレート制限エラー（カテゴリ: `API`、コード: `AGENT_RATE_LIMIT`）を
検出し、指数バックオフで自動リトライする:

- 基本遅延: 5 000 ms
- 最大遅延: 60 000 ms
- 計算式: `min(5000 * 2^attempt, 60000)`

リトライが尽きた場合、数分待ってから再実行する。

**予防策**: `--iterate-max` で総イテレーション数を制限し、過度な API
使用を避ける。

---

### 3.2 サンドボックス制限

**症状**: `Cannot execute SDK query() in double sandbox environment` または
`Claude Code process exited with code 1`。

**原因**: Claude Code の Bash ツール内でエージェントを実行すると、二重サンド
ボックスが発生する。外側のサンドボックスが内側の SDK
サンドボックスより先にネットワークアクセスをブロックする。

**解決策**:

1. 外部ターミナルから実行:
   ```bash
   deno task agent --agent iterator --issue 123
   ```
2. または外側のサンドボックスを無効化:
   ```typescript
   Bash({
     command: "deno task agent --agent iterator --issue 123",
     dangerouslyDisableSandbox: true,
   });
   ```

環境チェッカー（`environment-checker.ts`）がこの状況を検出し報告する:

- `insideClaudeCode`: `CLAUDE_CODE=1` または `CLAUDE_SESSION_ID` が設定されて
  いるか
- `sandboxed`: `SANDBOX_ENABLED=true` または `SANDBOX_ID` が設定されているか
- `nestLevel`: `CLAUDE_NEST_LEVEL` から解析（レベル > 1 で警告）

**予防策**: エージェント実行にはターミナルからの直接実行を推奨。

> **鑑別診断**: 同じ環境で他の agent が正常に動作する場合、原因はサンドボックス
> 制限ではない。 [3.4 permissionMode の不一致](#34-permissionmode-の不一致)
> を確認すること。

---

### 3.3 ツール権限エラー

**症状**: エージェントがツールを使用しようとするが権限拒否を受ける、または
期待されるアクションがサイレントにスキップされる。

**原因**: `config.json` や `steps_registry.json` の `allowedTools`
に必要なツールが含まれていない、または `permissionMode` が制限的すぎる。

**解決策**:

1. 設定の `allowedTools` を確認:
   ```json
   {
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
     }
   }
   ```
2. `filterAllowedTools()` が work/verification ステップ中にバウンダリツール
   （例: `githubIssueClose`）を自動除去するのは意図的な動作。

**予防策**: 必要なツールを `allowedTools` に明示的に宣言し、通常運用では
`acceptEdits` を使用する。

---

### 3.4 permissionMode の不一致

**症状**: `Claude Code process exited with code 1` が発生するが、同じ環境で他の
agent は正常に動作する。

**原因**: agent の `permissionMode` が `bypassPermissions` に設定されているが、
Claude Code 起動時に必要な `--dangerously-skip-permissions` CLI
フラグが指定されて いない。このフラグがないと Claude Code は即座に code 1
で終了する。

エラーメッセージがサンドボックス制限と同一のため、誤診されやすい。鑑別のポイント
は**他の agent が成功するかどうか** — 成功するなら環境は正常であり、問題は agent
固有の設定にある。

**解決策**:

1. agent の `permissionMode` を確認:
   ```bash
   cat .agent/<name>/agent.json | jq '.runner.boundaries.permissionMode'
   ```
2. `"bypassPermissions"` が返った場合:
   - `"acceptEdits"` に変更する（対話的な利用では推奨）:
     ```json
     {
       "runner": {
         "boundaries": {
           "permissionMode": "acceptEdits"
         }
       }
     }
     ```
   - または CI/無人実行環境で必要な CLI フラグが付与されていることを確認する。

**比較**:

| Agent A（成功） | Agent B（失敗）     | 診断                  |
| --------------- | ------------------- | --------------------- |
| `acceptEdits`   | `bypassPermissions` | permissionMode の問題 |
| `acceptEdits`   | `acceptEdits`       | この問題ではない      |

**エラー連鎖**: この問題が発生すると、ランナーが `[StepFlow] No intent produced`
も報告することがある。これはプロセスクラッシュに
起因する二次エラーであり、スキーマ設定の問題ではない。

**予防策**: `bypassPermissions` は必要な CLI フラグが保証されている CI/無人実行
環境でのみ使用する。対話的な開発では `acceptEdits` を使用する。

---

## 4. Agent 固有エラー

### 4.1 Breakdown CLI の空出力

**症状**: エージェントログに `Empty output from breakdown CLI`、またはプロンプト
ローダーが空のコンテンツを返す。

**原因**: C3L プロンプトファイルが期待されるパスに存在しない、または
`@tettuan/breakdown` CLI が空の結果を返した。

**解決策**:

1. 初期化を再実行してプロンプトテンプレートを再生成:
   ```bash
   deno run -A jsr:@aidevtool/climpt/agents/{agent-name} --init
   ```
2. プロンプトファイルの存在を確認:
   ```bash
   ls .agent/{agent-name}/prompts/
   ```

**予防策**: エージェント定義の変更や Climpt バージョンの更新時に `--init`
を実行する。

---

### 4.2 ステップルーティングエラー

**症状**: `AgentStepRoutingError`（コード: `FAILED_STEP_ROUTING`）または
`GateInterpretationError`（コード: `GATE_INTERPRETATION_ERROR`）。

**原因**: `StepGateInterpreter` が構造化出力からインテントを判定できなかった。
通常、LLM の応答が定義済みのトランジションのいずれにも一致しなかったことを意味
する。

**解決策**:

1. `steps_registry.json` の `transitions` がすべてのインテントをカバーして
   いるか確認:
   ```bash
   cat .agent/<name>/steps_registry.json | jq '.steps[].transitions'
   ```
2. `outputSchemaRef`
   が正しく設定されていることを確認（インテントルーティングには構造化出力が
   必須）。
3. `AgentStepIdMismatchError`（コード: `AGENT_STEP_ID_MISMATCH`）を確認 --
   スキーマの `stepId` フィールドに `"const"` 制約が不足している可能性がある。

**予防策**: `outputSchemaRef` に `stepId` の `const` 制約を必ず定義し、想定
されるすべてのインテントを `transitions` でカバーする。

---

### 4.3 Verdict / 完了判定の失敗

**症状**: `AgentMaxIterationsError`、メッセージ
`Maximum iterations (N) reached without finishing`、またはエージェントが無限に
実行される。

**原因**: Verdict 条件が満たされない。

**解決策**（Verdict タイプ別）:

| Verdict タイプ    | よくある原因                             | 修正方法                                           |
| ----------------- | ---------------------------------------- | -------------------------------------------------- |
| `detect:keyword`  | エージェント出力にキーワードが含まれない | `runner.verdict.config` の `verdictKeyword` を確認 |
| `count:iteration` | `maxIterations` が低すぎる               | `maxIterations` を増やす                           |
| `poll:state`      | Issue の状態が変わらない                 | `gh issue view <num> --json state` で確認          |
| `detect:graph`    | ステップが終端状態に到達しない           | `steps_registry.json` の `transitions` を見直す    |

**予防策**: 他の Verdict タイプを使用する場合でも、安全策として常に
`--iterate-max` を設定する。

---

### 4.4 C3L プロンプトファイルが見つからない

**エラー**:

```
[PATH] C3L prompt file not found: steps["initial.default"] → "prompts/steps/initial/default/f_default.md" does not exist
```

**原因**: `path-validator.ts` が各ステップの C3L プロンプトファイルの存在を
検証し、指定されたパスにファイルが見つからなかった。`steps_registry.json` で
参照されているプロンプトファイルが期待されるパスに存在しない。

**修正**:

1. エラーメッセージからステップ ID と期待されるパスを読み取る
2. 指示されたパスにファイルを作成する:
   ```bash
   mkdir -p .agent/<name>/prompts/steps/initial/default
   touch .agent/<name>/prompts/steps/initial/default/f_default.md
   ```
3. または、初期化を再実行してすべてのプロンプトテンプレートを再生成する:
   ```bash
   deno run -A jsr:@aidevtool/climpt/agents/iterator --init
   ```

**検証**:

```bash
deno task agent --agent <name> --validate
```

---

### 4.5 初期化エラーとワークツリーエラー

**症状**: `AgentNotInitializedError`（コード: `AGENT_NOT_INITIALIZED`）または
ワークツリーセットアップの失敗。

**原因**: `AgentRunner` が初期化の呼び出し前に使用された、または `setupWorktree`
がブランチ名の衝突やディレクトリの競合で失敗した。

**解決策**:

1. 初期化エラーの場合、`--init` を実行済みであることを確認:
   ```bash
   deno run -A jsr:@aidevtool/climpt/agents/iterator --init
   ```
2. ワークツリーエラーの場合、同名のブランチがないか確認:
   ```bash
   git branch -a | grep <worktree-branch-name>
   ```
3. 古いワークツリーディレクトリを削除:
   ```bash
   git worktree list
   git worktree remove <path>
   ```

**予防策**: 各エージェントセッションに一意のブランチ名を使用し、古い
ワークツリーを定期的にクリーンアップする。

---

## 5. デバッグ手法

### 5.1 --verbose フラグ

詳細な実行情報を表示するには verbose 出力を有効にする:

```bash
deno task agent --agent iterator --issue 123 --verbose
```

verbose 出力に含まれる情報:

- ステップ遷移とインテントルーティングの判定
- プロンプト読み込み結果（成功、失敗）
- 各イテレーションでの Verdict 評価
- 環境検出の結果

---

### 5.2 --validate フラグ

エージェントを実行せずに設定の構造的エラーをチェック:

```bash
deno task agent --agent my-agent --validate
```

`--validate` フラグは設定ファイル、スキーマ参照、および `steps_registry.json`
で定義されたすべてのステップの C3L プロンプトファイルの存在を検証する。

正常な場合の出力例:

```
agent.json: OK
steps_registry.json: OK
Prompt files: 4/4 found
Schema files: 2/2 valid
```

エラーがある場合の出力例:

```
agent.json: ERROR - Unknown key "runner.completion" (did you mean "runner.verdict"?)
steps_registry.json: WARNING - Step "plan" missing "stepKind" field
[PATH] C3L prompt file not found: steps["initial.default"] → "prompts/steps/initial/default/f_default.md" does not exist
```

解決手順は
[4.4 C3L プロンプトファイルが見つからない](#44-c3l-プロンプトファイルが見つからない)
を参照。

---

### 5.3 ログファイルの読み方

ログはロギングディレクトリ配下に JSONL 形式で保存される:

```
tmp/logs/agents/<agent-name>/session-<timestamp>.jsonl
```

便利な `jq` クエリ:

```bash
# 全ログレベルとメッセージを表示
cat tmp/logs/agents/iterator/*.jsonl | jq '{level: .level, message: .message}'

# エラーのみ抽出
cat tmp/logs/agents/iterator/*.jsonl | jq 'select(.level == "error")'

# エラーコードとガイダンスを表示
cat tmp/logs/agents/iterator/*.jsonl | jq 'select(.level == "error") | {code: .data.code, message: .data.message, guidance: .data.guidance}'

# ステップ遷移を追跡
cat tmp/logs/agents/iterator/*.jsonl | jq 'select(.message | test("step|transition"; "i"))'

# スキーマ解決状況を確認
cat tmp/logs/agents/iterator/*.jsonl | jq 'select(.message | test("schema|outputSchemaRef"; "i"))'
```

---

### 5.4 環境情報の確認

トラブルシューティングのための環境情報収集コマンド:

```bash
# Deno バージョンとキャッシュ情報
deno --version
deno info

# GitHub CLI の状態
gh auth status
gh api /user --jq '.login'

# Git リポジトリの状態
git status
git remote -v

# エージェント設定ファイルの確認
ls -la .agent/*/agent.json
ls -la .agent/*/steps_registry.json

# 二重サンドボックスのインジケーター確認
echo "CLAUDE_CODE=$CLAUDE_CODE"
echo "SANDBOX_ENABLED=$SANDBOX_ENABLED"
echo "CLAUDE_NEST_LEVEL=$CLAUDE_NEST_LEVEL"
```

---

## エラークラスリファレンス

すべてのエラーは `ClimptError`（エイリアス: `AgentError`）を継承する。各エラーは
`code`、`recoverable`、および `toJSON()` を提供し、構造化ログを出力する。

| エラークラス                     | コード                        | リカバリ可能 | カテゴリ    |
| -------------------------------- | ----------------------------- | ------------ | ----------- |
| `AgentNotInitializedError`       | `AGENT_NOT_INITIALIZED`       | No           | Runner      |
| `AgentQueryError`                | `AGENT_QUERY_ERROR`           | Yes          | Runner      |
| `AgentVerdictError`              | `AGENT_VERDICT_ERROR`         | Yes          | Runner      |
| `AgentTimeoutError`              | `AGENT_TIMEOUT`               | Yes          | Runner      |
| `AgentMaxIterationsError`        | `AGENT_MAX_ITERATIONS`        | No           | Runner      |
| `AgentRetryableQueryError`       | `AGENT_RETRYABLE_QUERY_ERROR` | Yes          | Runner      |
| `AgentSchemaResolutionError`     | `FAILED_SCHEMA_RESOLUTION`    | No           | Flow        |
| `AgentStepIdMismatchError`       | `AGENT_STEP_ID_MISMATCH`      | No           | Flow        |
| `AgentStepRoutingError`          | `FAILED_STEP_ROUTING`         | No           | Flow        |
| `GateInterpretationError`        | `GATE_INTERPRETATION_ERROR`   | No           | Flow        |
| `RoutingError`                   | `ROUTING_ERROR`               | No           | Flow        |
| `SchemaPointerError`             | `SCHEMA_POINTER_ERROR`        | No           | Flow        |
| `MalformedSchemaIdentifierError` | `MALFORMED_SCHEMA_IDENTIFIER` | No           | Flow        |
| `AgentEnvironmentError`          | `AGENT_ENVIRONMENT_ERROR`     | No           | Environment |
| `AgentRateLimitError`            | `AGENT_RATE_LIMIT`            | Yes          | Environment |
| `ConfigError (AC-LOAD-*)`        | `AC-LOAD-001..003`            | No           | Environment |
| `ConfigError (PR-FILE-001)`      | `PR-FILE-001`                 | No           | Environment |

---

## 関連ドキュメント

- [01-prerequisites.md](./01-prerequisites.md) -- Deno と gh CLI のセットアップ
- [02-climpt-setup.md](./02-climpt-setup.md) -- Climpt の初期化
- [04-iterate-agent-setup.md](./04-iterate-agent-setup.md) -- エージェントの実行
- [09-migration-guide.md](./09-migration-guide.md) -- 設定のマイグレーション

---

## サポート

このガイドで解決しない問題がある場合は、Issue を作成してください:
https://github.com/tettuan/climpt/issues
