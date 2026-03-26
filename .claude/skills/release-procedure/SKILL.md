---
name: release-procedure
description: Use when user says 'release', 'リリース', 'deploy', 'publish', 'vtag', 'version up', 'バージョンアップ', or discusses merging to main/develop. Guides through version bump and release flow.
allowed-tools: [Bash, Read, Edit, Grep, Glob, TaskCreate, TaskUpdate, TaskGet, TaskList]
---

# リリース手順

version bump → CI → docs → PR → remote CI待機 → merge → vtag の順で release/* から main へ段階的にリリースする。

**中断・確認不要ポリシー**: Gate pass かつ CI pass の場合、マージ確認やステップ間の中断は不要。全タスクを完遂するまで連続実行する。

関連skill: ブランチ戦略→`/branch-management`、CI実行→`/local-ci`、サンドボックス→`/git-gh-sandbox`

## Gate ルール（全タスク共通・最優先）

Gate は強制停止である。以下のルールは全タスクに適用され、例外は認めない。

1. **終了コードで判定**: Gate スクリプトが `exit 1` したら ABORT。echo 出力の目視判断に依存しない
2. **ABORT 時の行動**: タスクを `in_progress` のまま保持 → ABORT 理由をユーザーに報告 → 停止。次タスクへ進むことを禁止
3. **スキップ禁止**: 「軽微」「後で直す」「前タスクで確認済み」等の理由で Gate を省略することを禁止。Gate は毎回実行する
4. **Post-condition**: 各タスクの実行後、期待される成果物を検証してから `completed` にする。検証失敗 = ABORT

## タスク立案（最初に必ず実行）

スキル起動時、まず TaskCreate でリリース全体のタスクを作成する。バージョン番号はブランチ名から抽出する（`release/x.y.z` → `x.y.z`）。

以下のタスクを **この順番で** 作成し、`addBlockedBy` で依存関係を設定する：

| ID順 | subject | blockedBy |
|:--|:--|:--|
| 1 | Gate 0: Pre-flight チェック | — |
| 2 | バージョンアップ & ローカルCI | 1 |
| 3 | ドキュメント更新 | 2 |
| 4 | E2E検証 | 2 |
| 5 | PR作成: release/* → develop（バージョン検証付き） | 3, 4 |
| 6 | リモートCI待機: release/* → develop | 5 |
| 7 | マージ & 検証: release/* → develop | 6 |
| 8 | PR作成: develop → main（バージョン検証付き） | 7 |
| 9 | リモートCI待機: develop → main | 8 |
| 10 | マージ & 検証: develop → main | 9 |
| 11 | vtag作成 & リリース検証 | 10 |

各タスクは開始時に `in_progress`、完了時に `completed` へ更新する。

## バージョン管理

CIが `deno.json` と `src/version.ts` の一致を自動検証するので、`deno task bump-version` でブランチ名から両ファイルを同時更新する（手動指定も可: `deno task bump-version x.y.z`）。

```
パッチ(x.y.Z): バグ修正  マイナー(x.Y.0): 新機能(後方互換)  メジャー(X.0.0): 破壊的変更
```

## リリースフロー

### Task 1: Gate 0: Pre-flight

```bash
git fetch origin
```

Gate 1: release/* ブランチにいること
```bash
git branch --show-current | grep -q '^release/'
```

Gate 2: 未コミット変更がないこと
```bash
test -z "$(git status --short)"
```

Gate 3: ローカル develop が origin/develop と一致すること
```bash
test "$(git rev-parse develop 2>/dev/null)" = "$(git rev-parse origin/develop)"
```

Gate 4: 前リリースの vtag がリモートに存在すること（リリース漏れ検知）
```bash
BRANCH=$(git branch --show-current)
VER=${BRANCH#release/}
PATCH=$(echo $VER | cut -d. -f3)
if [ "$PATCH" -gt 0 ]; then
  PREV_TAG="v$(echo $VER | cut -d. -f1).$(echo $VER | cut -d. -f2).$((PATCH - 1))"
  git ls-remote --tags origin "refs/tags/$PREV_TAG" | grep -q . || { echo "ABORT: 前バージョン $PREV_TAG のタグがリモートに存在しない。前リリースが未完了の可能性"; exit 1; }
fi
```

### Task 2: バージョンアップ & ローカルCI

実行:
```bash
deno task bump-version
```

Post-condition: バージョンが正しく更新されたこと
```bash
BRANCH=$(git branch --show-current) && VER=${BRANCH#release/}
grep -q "\"version\": \"$VER\"" deno.json || { echo "ABORT: deno.json のバージョンが $VER と不一致"; exit 1; }
grep -q "$VER" src/version.ts || { echo "ABORT: src/version.ts のバージョンが $VER と不一致"; exit 1; }
```

CI & コミット & push:
```bash
deno task ci
git add deno.json src/version.ts && git commit -m "chore: bump version to $VER"
git push -u origin $(git branch --show-current)
```

Post-condition: bump commit が push されたこと
```bash
BRANCH=$(git branch --show-current)
UNPUSHED=$(git log origin/$BRANCH..$BRANCH --oneline 2>/dev/null)
test -z "$UNPUSHED" || { echo "ABORT: 未pushコミットあり: $UNPUSHED"; exit 1; }
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
./examples/01_setup/01_install.sh  # ~ 06_registry の各カテゴリを実行
./examples/07_clean.sh
```

### Task 5: PR作成 release/* → develop

Gate: バージョン・コミット・同期の検証。全 pass まで PR 作成禁止。
```bash
git fetch origin
BRANCH=$(git branch --show-current) && VER=${BRANCH#release/}

# deno.json バージョン一致
grep -q "\"version\": \"$VER\"" deno.json || { echo "ABORT: deno.json が $VER と不一致。Task 2 未完了"; exit 1; }
# src/version.ts バージョン一致
grep -q "$VER" src/version.ts || { echo "ABORT: src/version.ts が $VER と不一致。Task 2 未完了"; exit 1; }
# bump commit 存在
git log --oneline -20 | grep -q "bump version to $VER" || { echo "ABORT: bump commit が見つからない。Task 2 未完了"; exit 1; }
# 全コミット push 済み
test -z "$(git log origin/$BRANCH..$BRANCH --oneline 2>/dev/null)" || { echo "ABORT: 未pushコミットあり"; exit 1; }
# develop 同期
test "$(git rev-parse origin/develop)" = "$(git rev-parse develop 2>/dev/null)" || { echo "ABORT: develop が origin/develop と乖離"; exit 1; }
```

PR 作成:
```bash
gh pr create --base develop --head release/x.y.z --title "Release x.y.z: <概要>" --body "..."
```

### Task 6: リモートCI待機 release/* → develop

```bash
PR_NUM=$(gh pr view release/x.y.z --json number -q .number)
gh pr checks "$PR_NUM" --watch
```

- 全チェック pass → Task 7 へ
- いずれか fail → ABORT（失敗内容を報告）

### Task 7: マージ & 検証 release/* → develop

実行:
```bash
gh pr merge <PR番号> --merge
```

Post-condition: develop にバージョンが反映されていること
```bash
git fetch origin
VER=x.y.z
gh pr view <PR番号> --json state -q .state | grep -q "MERGED" || { echo "ABORT: PR が未マージ"; exit 1; }
git show origin/develop:deno.json | grep -q "\"version\": \"$VER\"" || { echo "ABORT: develop の deno.json が $VER と不一致。マージ内容に問題あり"; exit 1; }
```

### Task 8: PR作成 develop → main

Gate: develop 上のバージョン検証。全 pass まで PR 作成禁止。
```bash
git fetch origin
VER=x.y.z

# develop の deno.json バージョンが正しいか
git show origin/develop:deno.json | grep -q "\"version\": \"$VER\"" || { echo "ABORT: develop の deno.json が $VER と不一致"; exit 1; }
# ローカル develop を更新
git checkout develop && git reset --hard origin/develop
# main が origin/main と同期しているか
test "$(git rev-parse origin/main)" = "$(git rev-parse main 2>/dev/null)" || { echo "ABORT: main が origin/main と乖離"; exit 1; }
```

PR 作成:
```bash
gh pr create --base main --head develop --title "Release x.y.z" --body "..."
```

### Task 9: リモートCI待機 develop → main

```bash
PR_NUM=$(gh pr view develop --json number -q .number)
gh pr checks "$PR_NUM" --watch
```

- 全チェック pass → Task 10 へ
- いずれか fail → ABORT（失敗内容を報告）

### Task 10: マージ & 検証 develop → main

実行:
```bash
gh pr merge <PR番号> --merge
```

Post-condition: main にバージョンが反映されていること
```bash
git fetch origin
VER=x.y.z
gh pr view <PR番号> --json state -q .state | grep -q "MERGED" || { echo "ABORT: PR が未マージ"; exit 1; }
git show origin/main:deno.json | grep -q "\"version\": \"$VER\"" || { echo "ABORT: main の deno.json が $VER と不一致。マージ内容に問題あり"; exit 1; }
```

### Task 11: vtag作成 & リリース検証

**このタスクが completed にならない限りリリースは未完了。**

Gate:
```bash
git fetch origin
VER=x.y.z

# main の deno.json バージョンが正しいか
git show origin/main:deno.json | grep -q "\"version\": \"$VER\"" || { echo "ABORT: main の deno.json が $VER と不一致"; exit 1; }
# 同名タグが既に存在しないか
git tag -l "v$VER" | grep -q . && { echo "ABORT: tag v$VER already exists"; exit 1; }
```

vtag 作成:
```bash
git tag v$VER origin/main && git push origin v$VER
```

Post-condition: タグがリモートに存在すること
```bash
git ls-remote --tags origin "refs/tags/v$VER" | grep -q . || { echo "ABORT: リモートに v$VER タグが存在しない。push 失敗の可能性"; exit 1; }
```

## 連続実行ポリシー

Gate pass かつ CI pass している限り、全ステップを中断なく連続実行する。ユーザーへの確認は不要。

**Gate NG・CI fail・Post-condition fail は全て同等の停止条件。** 原因を解消し、該当 Gate/Post-condition を再実行して pass するまで次タスクへ進むことを禁止。

## トラブルシューティング

| 症状 | 原因 | 対処 |
|:--|:--|:--|
| JSR publishスキップ | deno.jsonバージョンが既存と同一 | バージョンを上げて再リリース |
| CIバージョンチェック失敗 | deno.json・version.ts・ブランチ名の不一致 | 全て同じバージョンに統一してcommit & push |
| vtagが古いコミット | タグが旧コミットを参照 | `git tag -d vx.y.z && git push origin :refs/tags/vx.y.z` で削除後、`git tag vx.y.z origin/main && git push origin vx.y.z` で再作成 |
| リモートCI待機タイムアウト | GitHub Actions が混雑 | `gh run list` で状態確認、re-run が必要なら `gh run rerun <run-id>` |
| 前バージョンのタグ欠落 | 前リリースで vtag 未作成 | 前バージョンの vtag を先に作成してからリリースを再開 |
