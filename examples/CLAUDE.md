# Examples Execution Guide

## What

`examples/` は Climpt の E2E 検証パイプライン。
番号付きスクリプトが順序依存で並び、各ステップが前ステップの生成物に依存する。
一覧と構造は `examples/README.md` の Directory Structure テーブルを参照。

## 定期実行の有効化/無効化

`run-all.sh` は launchd (`com.climpt.run-all`) により 5 分間隔で定期実行される。
フラグファイルが存在するときのみ実行され、不在時はスキップする。

```bash
# 有効化
touch tmp/.examples-run-enabled

# 無効化
rm tmp/.examples-run-enabled
```

手動実行時もこのガードが効く。ターミナルから走らせる前に有効化すること。

## cwd ルール

**すべての run.sh は `examples/` ディレクトリを cwd として実行する。**

- `climpt init` → `examples/.agent/climpt/` に作成される
- agent init → `examples/.agent/<agent>/` に作成される
- REPO_ROOT のファイル参照は絶対パスを使う
- `deno task` は REPO_ROOT の deno.json に依存するため使わない。代わりに
  `deno run --allow-all "$REPO_ROOT/agents/scripts/run-agent.ts"` で直接実行する

## Why

- 順序依存: 各 example は前ステップの状態に依存する。順序を守らないと失敗する
- ネスト不可: Claude Code は内部で Claude Code を起動できない。直接 Bash
  で走らせると壊れる
- 状態リセット: `99_clean`
  で全アーティファクトが消える。途中再開は不可能で最初からやり直し
- 環境分離: examples は REPO_ROOT の `.agent/` を汚染しない。 `examples/.agent/`
  を独立した作業環境として使う

## How

Conductor パターンで実行する。自分では実行せず、sub-agent に委譲する。

### 1. README.md を読んで計画する

`examples/README.md` の Directory Structure テーブルから全 example を把握する。
ディレクトリ名の番号順がそのまま実行順序。

### 2. TaskCreate でタスクリスト化する

README.md のテーブルから番号順にタスクを作成する。 1つ完了 → 記録 →
次へ。並列化しない。失敗したら止めて原因調査。

**微細なエラーも看過しないこと。**
警告・非ゼロ終了・想定外の出力はすべて調査対象とする。

### 3. 各タスクを sub-agent に委譲する

| 判断     | アクション                                                           |
| -------- | -------------------------------------------------------------------- |
| 実行     | Agent tool (general-purpose) に `bash examples/NN_xxx/run.sh` を委譲 |
| 調査     | Agent tool (Explore) でスクリプト内容を確認                          |
| 直接実行 | しない。メインの Bash tool で example を走らせない                   |

Claude Code のネスト実行は失敗する（examples 21-22, 24, 31, 36, 41 は内部で
Claude Code を起動する）。

**sub-agent への権限伝達:** sub-agent に委譲する際、以下を prompt
に明記して権限をクリアさせること。

- サンドボックス制約でネットワークアクセスがブロックされる場合は
  `dangerouslyDisableSandbox` を使う
- Claude Code のネスト実行は不可。`run.sh` 内部で Claude Code
  を起動するスクリプトは直接 `bash` で実行する
- `deno task agent` は `--allow-all` 相当の Deno 権限が必要
- `gh` コマンドは GitHub CLI 認証が必要
- `.agent/` 配下へのファイル書き込みが発生する

### 4. 権限を事前に確認する

- `deno task agent`: `--allow-all` 相当の Deno 権限が必要
- `gh` コマンド: GitHub CLI 認証が必要
- `.agent/` 配下: ファイル書き込みが発生する
- サンドボックス: ネットワークアクセスをブロックする場合がある

### 5. クリーンアップ後は 01 から再開する

`99_clean/run.sh` は全アーティファクトを削除する。 `01_check_prerequisites`
から再開すること。

## LLM ステップの認証

LLM ステップ (21-22, 24, 31, 36, 41) は `@anthropic-ai/claude-agent-sdk` の
`query()` を使う。`query()` は `claude` CLI を子プロセスとして spawn する。

**認証は OAuth が前提。** `claude` CLI がインストール済みかつ OAuth
認証済みであれば `ANTHROPIC_API_KEY` は不要。

### 検証スクリプト

LLM ステップの実行前に、SDK が動作するか単体で確認できる。

```bash
# OAuth SDK query テスト（API キー不要）
bash examples/scripts/run-test-sdk-query.sh

# Plan モード承認テスト（approve / deny）
bash examples/scripts/run-test-plan-mode.sh
```

- `test-sdk-query.ts`: 最小の `query()` 呼び出し。OAuth 認証と API
  通信を検証する。これが通れば LLM ステップも動く
- `test-plan-mode.ts`: `permissionMode: "plan"` で `canUseTool`
  コールバックによる承認・拒否を検証する

## Troubleshooting

### SDK バージョン不整合

`query()` が API Error 400 `Unexpected value(s) for the anthropic-beta header`
を返す場合、SDK バージョンが古い。

```bash
# バージョン確認
deno info --json | grep claude-agent-sdk
# または
grep claude-agent-sdk ../../deno.json

# 更新
# deno.json の @anthropic-ai/claude-agent-sdk バージョンを上げて deno install
```

### Claude Code 内からの実行

Claude Code の Bash ツールから `run-all.sh` を実行すると、環境変数
`CLAUDE_CODE_ENTRYPOINT` 等が子プロセスに継承される。SDK `query()` は
これを検知してネスト実行となり、子プロセスが失敗する。

**対処:**

- `run-all.sh` はターミナルから直接実行する（推奨）
- Claude Code 内で実行する場合は `common_functions.sh` の `clear_claude_env` を
  LLM ステップの前に呼ぶ

### check_llm_ready の判定

`common_functions.sh:check_llm_ready` は以下の順で認証を検出する:

1. `ANTHROPIC_API_KEY` が設定されている
2. `CLAUDE_CODE_ENTRYPOINT` が設定されている（Claude Code 内部認証）
3. `claude` CLI が PATH に存在する（OAuth）

Claude Code 内では条件 2 が常に真になるが、SDK `query()` の子プロセスが
ネスト制約で失敗する。このとき `check_llm_ready` は PASS を返すが 実際には LLM
呼び出しは動かない。ターミナルから実行すれば条件 3 で正しく判定される。

### run-all.sh の失敗伝播

`run-all.sh` は失敗ステップがあれば `exit 1` を返す。 LLM
ステップが認証不足で失敗した場合も全体が失敗扱いとなる。
