---
name: upgrade-climpt
description: Use when user says 'upgrade climpt', 'update climpt', 'climpt バージョンアップ', 'climpt 更新', 'climpt upgrade', or wants to update their climpt installation to the latest version. Guides through JSR update, cache reload, docs update, and validation.
allowed-tools: [Bash, Read, Grep, Glob, TaskCreate, TaskUpdate, TaskGet, TaskList]
---

# Climpt バージョンアップ手順

利用者の Climpt 環境を最新バージョンへ更新する。

## 手順概要

1. 現在のバージョン確認
2. JSR からパッケージ更新 + キャッシュリロード
3. ドキュメント更新
4. バリデーション（動作確認）

## 実行モデル

各ステップを sub-agent に委譲し、メインコンテキストの Token を消費しない。

## ステップ

### Step 1: 現在のバージョン確認

```bash
deno run -A jsr:@aidevtool/climpt/cli --version
```

出力例: `Climpt v1.13.18` — 更新前のバージョンを記録する。

### Step 2: JSR からパッケージ更新 + キャッシュリロード

`-r` フラグで Deno キャッシュを無効化し、JSR から最新版を取得する。

```bash
deno run -Ar jsr:@aidevtool/climpt/cli --version
```

バージョン番号が Step 1 から上がっていれば更新成功。同一なら最新版を使用中。

### Step 3: ドキュメント更新

`.agent/climpt/docs/` にドキュメントをインストール（または上書き更新）する。

```bash
deno run -Ar jsr:@aidevtool/climpt/docs install .agent/climpt/docs
```

オプション:

| フラグ | 用途 | 例 |
|:--|:--|:--|
| `--lang=ja` | 日本語のみ | `--lang=ja` |
| `--category=guides` | ガイドのみ | `--category=guides` |
| `--mode=flatten` | フラット配置 | `--mode=flatten` |
| `--mode=single` | 単一ファイルに結合 | `--mode=single` |

### Step 4: バリデーション

更新後の動作確認。全 pass で完了。

**4a. バージョン確認:**
```bash
deno run -A jsr:@aidevtool/climpt/cli --version
```

**4b. init の動作確認:**
```bash
deno run -A jsr:@aidevtool/climpt/cli init --force
```
`.agent/climpt/` 配下に config, prompts ディレクトリが存在すること。

**4c. echo テスト（プロンプト実行の疎通確認）:**
```bash
echo "hello" | deno run -A jsr:@aidevtool/climpt/cli echo input --config=test
```
出力に `hello` が含まれていれば OK。設定未投入の環境では 4a, 4b のみで可。

**4d. ドキュメントの確認:**
```bash
deno run -A jsr:@aidevtool/climpt/docs list
```
最新バージョンのエントリ一覧が表示されること。

## トラブルシューティング

| 症状 | 対処 |
|:--|:--|
| バージョンが上がらない | `deno run -Ar` の `-r` を確認。DENO_DIR が複数ある場合は `~/.cache/deno` と `~/Library/Caches/deno` 両方を確認 |
| JSR fetch 失敗 | ネットワーク接続を確認。プロキシ環境なら `HTTPS_PROXY` を設定 |
| init 失敗 | `.agent/climpt/` の書き込み権限を確認。`--force` で既存を上書き |
| docs install 失敗 | 出力先ディレクトリの書き込み権限を確認 |
