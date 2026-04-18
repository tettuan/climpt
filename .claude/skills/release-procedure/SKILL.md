---
name: release-procedure
description: Use when user says 'release', 'リリース', 'deploy', 'publish', 'vtag', 'version up', 'バージョンアップ', or discusses merging to main/develop. Guides through version bump and release flow.
allowed-tools: [Bash, Read, Edit, Grep, Glob, TaskCreate, TaskUpdate, TaskGet, TaskList]
---

# リリース手順

version bump → CI → docs → PR → remote CI待機 → merge → vtag の順で release/* から main へ段階的にリリースする。

## 実行 vs 参照（最優先ルール）

このスキルには2つの利用モードがある。最初にどちらか判定する。

| モード | 判定基準 | 動作 |
|:--|:--|:--|
| **実行** | リリースを実際に行う指示（「release して」「merge して」「vtag 作って」「develop に入れて」等） | Task 1 から全 13 タスクを順に実行。部分実行禁止 |
| **参照** | 手順の説明・確認を求める指示（「手順を教えて」「release手順を参考に」等） | 情報提供のみ。タスク作成・コマンド実行しない |

### 実行モードの部分実行禁止

実行モードでは、ユーザーの指示が特定のタスクだけを示唆していても、Task 1 から開始する。各 Gate が現在の状態を検証するため、既に完了済みの状態であれば Gate は高速に通過する。部分実行が不要な理由: Gate の通過コストは低く、スキップによるリスク（CI未通過のまま PR作成等）は高い。

## 実行ポリシー

- **中断不要**: Gate pass かつ CI pass の場合、確認やステップ間の中断は不要。全タスクを完遂するまで連続実行する
- **停止条件**: Gate NG・CI fail・Post-condition fail は全て同等の停止条件。原因を解消し再実行して pass するまで次タスクへ進むことを禁止

関連skill: `/branch-management`、`/local-ci`、`/git-gh-sandbox`

## Gate ルール（全タスク共通）

1. **終了コードで判定**: Gate スクリプトが `exit 1` したら ABORT。echo 出力の目視判断に依存しない
2. **ABORT 時の行動**: タスクを `in_progress` のまま保持 → ABORT 理由をユーザーに報告 → 停止。次タスクへ進むことを禁止
3. **スキップ禁止**: 「軽微」「後で直す」「前タスクで確認済み」等の理由で Gate を省略することを禁止。Gate は毎回実行する
4. **Post-condition**: 各タスクの実行後、期待される成果物を検証してから `completed` にする。検証失敗 = ABORT

## 共通変数

各 Task で以下を使用する。ブランチ名からバージョンを抽出：

```bash
BRANCH=$(git branch --show-current) && VER=${BRANCH#release/}
```

## タスク立案（最初に必ず実行）

スキル起動時、TaskCreate で全タスクを作成。`addBlockedBy` で依存関係を設定：

| # | subject | blockedBy |
|:--|:--|:--|
| 1 | Gate 0: Pre-flight チェック | — |
| 2 | バージョンアップ & ローカルCI | 1 |
| 3 | ドキュメント更新 | 2 |
| 4 | E2E検証 | 2 |
| 5 | リモートCI事前テスト (workflow_dispatch) | 3, 4 |
| 6 | PR作成: release/* → develop（バージョン検証付き） | 5 |
| 7 | リモートCI待機: release/* → develop | 6 |
| 8 | マージ & 検証: release/* → develop | 7 |
| 9 | PR作成: develop → main（バージョン検証付き） | 8 |
| 10 | リモートCI待機: develop → main | 9 |
| 11 | マージ & 検証: develop → main | 10 |
| 12 | vtag作成 & リリース検証 | 11 |
| 13 | 次バージョン用ブランチ作成 & 初期 bump | 12 |

各タスクは開始時に `in_progress`、完了時に `completed` へ更新。

## 実行モデル: Conductor + Sub-agent

メインコンテキストは **Conductor（指揮者）** として振る舞う。各タスクの実行は Agent tool で sub-agent に委譲し、メインの Token を消費しない。

**Conductor の責務:**
- タスク立案（TaskCreate / TaskUpdate）
- 各タスクを sub-agent に委譲
- sub-agent の結果を受けて ABORT 判定・次タスク遷移

**Sub-agent への委譲ルール:**
- 1タスク = 1 sub-agent。タスクの bash コマンド・Gate・Post-condition をすべて prompt に含めて委譲する
- sub-agent は `general-purpose` タイプで起動し、`dangerouslyDisableSandbox: true` が必要な場合はその旨を prompt に明記する（git push, gh コマンド等）
- sub-agent の結果（pass / ABORT + 理由）をもとに Conductor が TaskUpdate する
- Conductor 自身が Bash tool で直接コマンドを実行しない

## リリースフロー

### Task 1: Gate 0: Pre-flight

```bash
bash .claude/skills/release-procedure/scripts/preflight.sh
```

### Task 2: バージョンアップ & ローカルCI

```bash
deno task bump-version
```

Post-condition:
```bash
bash .claude/skills/release-procedure/scripts/verify-version.sh
```

CI & コミット & push:
```bash
deno task ci
BRANCH=$(git branch --show-current) && VER=${BRANCH#release/}
git add deno.json src/version.ts && git commit -m "chore: bump version to $VER"
git push -u origin $BRANCH
```

Post-condition:
```bash
bash .claude/skills/release-procedure/scripts/verify-version.sh --with-push
```

### Task 3: ドキュメント更新（PR作成前必須）

| 対象 | 方法 |
|:--|:--|
| CHANGELOG.md | `/update-changelog` で変更記載、[x.y.z] - YYYY-MM-DD へ移動 |
| README・--help等 | `/update-docs` で変更種別に応じた箇所を更新 |
| docs/manifest.json | version・entries・bytes を実ファイルと一致させる |

### Task 4: E2E検証（ローカルCI通過後）

実行:
```bash
chmod +x examples/**/*.sh examples/*.sh
./examples/run-all.sh
```

クリーンアップ（E2E生成物を除去し working tree を clean に戻す）:
```bash
./examples/53_clean/run.sh
git checkout -- .
```

Post-condition:
```bash
test -z "$(git status --short)" || { echo "ABORT: dirty tree after E2E"; exit 1; }
```

### Task 5: リモートCI事前テスト (workflow_dispatch)

PR作成前にリモートCIでテストを実行し、失敗を早期検知する。

```bash
BRANCH=$(git branch --show-current)
gh workflow run test.yml --ref "$BRANCH"
```

実行開始を待ってから watch:
```bash
sleep 5
RUN_ID=$(gh run list --workflow=test.yml --branch="$BRANCH" --limit=1 --json databaseId --jq '.[0].databaseId')
gh run watch "$RUN_ID" --exit-status
```

Post-condition:
```bash
BRANCH=$(git branch --show-current)
RUN_ID=$(gh run list --workflow=test.yml --branch="$BRANCH" --limit=1 --json databaseId,conclusion --jq '.[0].databaseId')
CONCLUSION=$(gh run view "$RUN_ID" --json conclusion --jq '.conclusion')
test "$CONCLUSION" = "success" || { echo "ABORT: Remote CI failed (conclusion=$CONCLUSION)"; exit 1; }
```

### Task 6: PR作成 release → develop

Gate: 全 pass まで PR 作成禁止。
```bash
bash .claude/skills/release-procedure/scripts/verify-version.sh --with-push
git fetch origin
BRANCH=$(git branch --show-current) && VER=${BRANCH#release/}
git log --oneline -20 | grep -q "bump version to $VER" || { echo "ABORT: no bump commit"; exit 1; }
test "$(git rev-parse origin/develop)" = "$(git rev-parse develop 2>/dev/null)" || { echo "ABORT: develop diverged"; exit 1; }
```

```bash
gh pr create --base develop --head release/x.y.z --title "Release x.y.z: <概要>" --body "..."
```

### Task 7: リモートCI待機: release → develop

[テンプレート: リモートCI待機](references/templates.md) を `{pr_head}=release/x.y.z` で実行。

### Task 8: マージ & 検証: release → develop

[テンプレート: マージ & 検証](references/templates.md) を `{base}=develop` で実行。

### Task 9: PR作成 develop → main

Gate: 全 pass まで PR 作成禁止。
```bash
git fetch origin
BRANCH=$(git branch --show-current) && VER=${BRANCH#release/}
git show origin/develop:deno.json | grep -q "\"version\": \"$VER\"" || { echo "ABORT: develop version mismatch"; exit 1; }
git checkout develop && git reset --hard origin/develop
test "$(git rev-parse origin/main)" = "$(git rev-parse main 2>/dev/null)" || { echo "ABORT: main diverged"; exit 1; }
```

```bash
gh pr create --base main --head develop --title "Release x.y.z" --body "..."
```

### Task 10: リモートCI待機: develop → main

[テンプレート: リモートCI待機](references/templates.md) を `{pr_head}=develop` で実行。

### Task 11: マージ & 検証: develop → main

[テンプレート: マージ & 検証](references/templates.md) を `{base}=main` で実行。

### Task 12: vtag作成 & リリース検証

**このタスクが completed にならない限りリリースは未完了。**

Gate:
```bash
git fetch origin
BRANCH=$(git branch --show-current) && VER=${BRANCH#release/}
git show origin/main:deno.json | grep -q "\"version\": \"$VER\"" || { echo "ABORT: main version mismatch"; exit 1; }
git tag -l "v$VER" | grep -q . && { echo "ABORT: tag v$VER already exists"; exit 1; }
```

```bash
git tag v$VER origin/main && git push origin v$VER
```

Post-condition:
```bash
git ls-remote --tags origin "refs/tags/v$VER" | grep -q . || { echo "ABORT: tag not on remote"; exit 1; }
```

### Task 13: 次バージョン用ブランチ作成 & 初期 bump

vtag 完了後、次の開発サイクル用に `release/<次バージョン>` ブランチを切る。**bump → commit → push の順序を厳守**: bump 前 push は branch だけが先行してリモートに上がり、version mismatch のまま CI が走る誤誘発を起こす。

次バージョン決定ルール: デフォルトは patch increment。user 指示で minor/major を指定された場合はそれに従う。

Gate（前提検証）:
```bash
git fetch origin
PREV_BRANCH=$(git branch --show-current) && PREV_VER=${PREV_BRANCH#release/}
test "$(git rev-parse origin/main)" = "$(git rev-parse main 2>/dev/null)" || { echo "ABORT: local main not synced with origin/main"; exit 1; }
git tag -l "v$PREV_VER" | grep -q . || { echo "ABORT: v$PREV_VER tag missing — Task 12 incomplete"; exit 1; }
```

次バージョン算出（patch increment 例。minor/major は IFS 解析で同様）:
```bash
IFS=. read -r MAJ MIN PATCH <<<"$PREV_VER"
NEXT_VER="$MAJ.$MIN.$((PATCH+1))"
git rev-parse "release/$NEXT_VER" >/dev/null 2>&1 && { echo "ABORT: branch release/$NEXT_VER already exists"; exit 1; }
git ls-remote --heads origin "release/$NEXT_VER" | grep -q . && { echo "ABORT: remote branch release/$NEXT_VER already exists"; exit 1; }
```

ブランチ作成 → bump → verify → commit → push（順序固定）:
```bash
git checkout main && git pull origin main
git checkout -b "release/$NEXT_VER"
deno task bump-version
bash .claude/skills/release-procedure/scripts/verify-version.sh
git add deno.json src/version.ts && git commit -m "chore: bump version to $NEXT_VER"
git push -u origin "release/$NEXT_VER"
```

Post-condition:
```bash
bash .claude/skills/release-procedure/scripts/verify-version.sh --with-push
git ls-remote --heads origin "release/$NEXT_VER" | grep -q . || { echo "ABORT: branch not on remote"; exit 1; }
git log -1 --pretty=%s | grep -q "bump version to $NEXT_VER" || { echo "ABORT: bump commit not on tip"; exit 1; }
```

順序違反の検出（bump 前に push してしまった場合）:
- ローカル変更が無い (clean) 状態で push されていれば bump コミットが欠落 → 即 Gate fail として再実行
- verify-version.sh --with-push がリモートと version 一致を確認するため、不一致は ABORT

## トラブルシューティング

ABORT 発生時は [references/troubleshooting.md](references/troubleshooting.md) を参照。
