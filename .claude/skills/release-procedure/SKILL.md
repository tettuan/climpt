---
name: release-procedure
description: Use when user says 'release', 'リリース', 'deploy', 'publish', 'vtag', 'version up', 'バージョンアップ', or discusses merging to main/develop. Guides through version bump and release flow.
allowed-tools: [Bash, Read, Edit, Grep, Glob, TaskCreate, TaskUpdate, TaskGet, TaskList]
---

# リリース手順

version bump → CI → docs → PR → remote CI待機 → merge → vtag の順で release/* から main へ段階的にリリースする。各マージはユーザーの明示的指示を待ってから実行する。

関連skill: ブランチ戦略→`/branch-management`、CI実行→`/local-ci`、サンドボックス→`/git-gh-sandbox`

## タスク立案（最初に必ず実行）

スキル起動時、まず TaskCreate でリリース全体のタスクを作成する。バージョン番号はブランチ名または `deno.json` から取得する。

以下のタスクを **この順番で** 作成し、`addBlockedBy` で依存関係を設定する：

| ID順 | subject | blockedBy |
|:--|:--|:--|
| 1 | Gate 0: Pre-flight チェック | — |
| 2 | バージョンアップ & ローカルCI | 1 |
| 3 | ドキュメント更新 | 2 |
| 4 | E2E検証 | 2 |
| 5 | PR作成: release/* → develop | 3, 4 |
| 6 | リモートCI待機: release/* → develop | 5 |
| 7 | マージ: release/* → develop | 6 |
| 8 | PR作成: develop → main | 7 |
| 9 | リモートCI待機: develop → main | 8 |
| 10 | マージ: develop → main | 9 |
| 11 | vtag作成 & クリーンアップ | 10 |

各タスクは開始時に `in_progress`、完了時に `completed` へ更新する。Gate NG やCI失敗で止まった場合は `in_progress` のまま保持し、原因を報告する。

## バージョン管理

CIが `deno.json` と `src/version.ts` の一致を自動検証するので、`deno task bump-version` でブランチ名から両ファイルを同時更新する（手動指定も可: `deno task bump-version x.y.z`）。

```
パッチ(x.y.Z): バグ修正  マイナー(x.Y.0): 新機能(後方互換)  メジャー(X.0.0): 破壊的変更
```

## リリースフロー

各ステップに Gate check（前提条件の検知）を設ける。Gate が NG なら先に進まず原因を解消する。

### Task 1: Gate 0: Pre-flight（リリース作業開始前）

```bash
git fetch origin
# 1. release/* ブランチにいるか
git branch --show-current | grep -q '^release/' || echo "ERROR: release/* ブランチではない"
# 2. ローカル develop が origin/develop と一致するか
git rev-parse develop 2>/dev/null && git diff develop origin/develop --stat  # 差分があれば diverge
# 3. 未コミット変更がないか
git status --short  # 出力があれば未コミットあり
# 4. 前リリースが develop に入っているか（直前の release/* ブランチのマージ確認）
git log --oneline origin/develop -5  # 直前の release マージコミットが含まれているか目視確認
```

全て OK なら Task 2 へ進む。

### Task 2: バージョンアップ & ローカルCI

```bash
deno task bump-version
grep '"version"' deno.json && grep 'CLIMPT_VERSION' src/version.ts  # 一致確認
deno task ci
git add deno.json src/version.ts && git commit -m "chore: bump version to x.y.z"
git push -u origin release/x.y.z
```

### Task 3: ドキュメント更新（PR作成前必須）

| 対象 | 方法 |
|:--|:--|
| CHANGELOG.md | `/update-changelog` で変更記載、リリース時に [x.y.z] - YYYY-MM-DD へ移動 |
| README・--help等 | `/update-docs` で変更種別に応じた箇所を更新 |
| docs/manifest.json | version・entries・bytes を実ファイルと一致させる |

### Task 4: E2E検証（ローカルCI通過後）

```bash
chmod +x examples/**/*.sh examples/*.sh
./examples/01_setup/01_install.sh  # ～ 06_registry の各カテゴリを実行
./examples/07_clean.sh
```

### Task 5: PR作成 release/* → develop

Gate check を実行してから PR を作成する。

```bash
git fetch origin
# Gate: release/* の全コミットが push 済みか
git log origin/release/x.y.z..release/x.y.z --oneline  # 出力があれば未 push
# Gate: develop が origin/develop と同期しているか
[ "$(git rev-parse origin/develop)" = "$(git rev-parse develop 2>/dev/null)" ] && echo "OK" || echo "ERROR: develop diverged — git checkout develop && git reset --hard origin/develop"

# PR作成
gh pr create --base develop --head release/x.y.z --title "Release x.y.z: <概要>" --body "..."
```

### Task 6: リモートCI待機 release/* → develop

PR作成後、リモートCIの完了を待機する。全チェックがpassするまで次へ進まない。

```bash
# PR番号を取得
PR_NUM=$(gh pr view release/x.y.z --json number -q .number)
# リモートCIの完了を待機（全チェックpass or fail を検知するまでブロック）
gh pr checks "$PR_NUM" --watch
```

- 全チェック pass → Task 7 へ進む旨をユーザーに報告
- いずれかが fail → 失敗内容を報告し、ユーザー指示を待つ（タスクは `in_progress` 保持）

### Task 7: マージ release/* → develop

**ユーザーの明示的指示を待ってから実行する。**

```bash
gh pr merge <PR番号> --merge
```

### Task 8: PR作成 develop → main

Gate check を実行してから PR を作成する。

```bash
git fetch origin
# Gate: Task 7 の PR がマージ済みか
git log --oneline origin/develop -3  # release/x.y.z のマージコミットが見えるか
# Gate: ローカル develop を更新
git checkout develop && git reset --hard origin/develop
# Gate: main が origin/main と同期しているか
[ "$(git rev-parse origin/main)" = "$(git rev-parse main 2>/dev/null)" ] && echo "OK" || echo "ERROR: main diverged"

# PR作成
gh pr create --base main --head develop --title "Release x.y.z" --body "..."
```

### Task 9: リモートCI待機 develop → main

PR作成後、リモートCIの完了を待機する。

```bash
# PR番号を取得
PR_NUM=$(gh pr view develop --json number -q .number)
# リモートCIの完了を待機
gh pr checks "$PR_NUM" --watch
```

- 全チェック pass → Task 10 へ進む旨をユーザーに報告
- いずれかが fail → 失敗内容を報告し、ユーザー指示を待つ

### Task 10: マージ develop → main

**ユーザーの明示的指示を待ってから実行する。** mainマージでJSR publish自動実行。

```bash
gh pr merge <PR番号> --merge
```

### Task 11: vtag作成 & クリーンアップ

Gate check を実行してからタグを作成する。

```bash
git fetch origin
# Gate: Task 10 の PR がマージ済みか
git log --oneline origin/main -3  # develop マージコミットが見えるか
# Gate: 同名タグが既に存在しないか
git tag -l "vx.y.z" | grep -q . && echo "ERROR: tag vx.y.z already exists" || echo "OK"

# vtag作成
git tag vx.y.z origin/main && git push origin vx.y.z  # 必ずmainのコミットに付与
# ブランチ削除は /branch-management 参照
```

## 連続マージ禁止

誤操作防止のため、release→develop→mainを一気にマージせず、各PR作成後にユーザーへ報告して次の指示（「developまで」「mainまで」等）を待つ。vtag作成も同様。

## トラブルシューティング

| 症状 | 原因 | 対処 |
|:--|:--|:--|
| JSR publishスキップ | deno.jsonバージョンが既存と同一 | バージョンを上げて再リリース |
| CIバージョンチェック失敗 | deno.json・version.ts・ブランチ名の不一致 | 全て同じバージョンに統一してcommit & push |
| vtagが古いコミット | タグが旧コミットを参照 | `git tag -d vx.y.z && git push origin :refs/tags/vx.y.z` で削除後、`git tag vx.y.z origin/main && git push origin vx.y.z` で再作成 |
| リモートCI待機タイムアウト | GitHub Actions が混雑 | `gh run list` で状態確認、re-run が必要なら `gh run rerun <run-id>` |
