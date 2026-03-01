# Examples Execution Guide

## What

`examples/` は Climpt の E2E 検証パイプライン。
番号付きスクリプトが順序依存で並び、各ステップが前ステップの生成物に依存する。
一覧と構造は `examples/README.md` の Directory Structure テーブルを参照。

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
- 状態リセット: `31_clean`
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

Claude Code のネスト実行は失敗する（examples 21-26a は内部で Claude Code
を起動する）。

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

`31_clean/run.sh` は全アーティファクトを削除する。 `01_check_prerequisites`
から再開すること。
