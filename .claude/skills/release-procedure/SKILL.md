---
name: release-procedure
description: Use when user says 'release', 'リリース', 'deploy', 'publish', 'vtag', 'version up', 'バージョンアップ', or discusses merging to main/develop. Guides through version bump and release flow.
allowed-tools: [Bash, Read, Edit, Grep, Glob]
---

# リリース手順

version bump → CI → docs → PR → merge → vtag の順で release/* から main へ段階的にリリースする。各マージはユーザーの明示的指示を待ってから実行する。

関連skill: ブランチ戦略→`/branch-management`、CI実行→`/local-ci`、サンドボックス→`/git-gh-sandbox`

## バージョン管理

CIが `deno.json` と `src/version.ts` の一致を自動検証するので、`deno task bump-version` でブランチ名から両ファイルを同時更新する（手動指定も可: `deno task bump-version x.y.z`）。

```
パッチ(x.y.Z): バグ修正  マイナー(x.Y.0): 新機能(後方互換)  メジャー(X.0.0): 破壊的変更
```

## リリースフロー

### 1. release/* ブランチでバージョンアップ

```bash
deno task bump-version
grep '"version"' deno.json && grep 'CLIMPT_VERSION' src/version.ts  # 一致確認
deno task ci
git add deno.json src/version.ts && git commit -m "chore: bump version to x.y.z"
git push -u origin release/x.y.z
```

### 2. ドキュメント更新（PR作成前必須）

| 対象 | 方法 |
|:--|:--|
| CHANGELOG.md | `/update-changelog` で変更記載、リリース時に [x.y.z] - YYYY-MM-DD へ移動 |
| README・--help等 | `/update-docs` で変更種別に応じた箇所を更新 |
| docs/manifest.json | version・entries・bytes を実ファイルと一致させる |

### 3. E2E検証（CI通過後、PR作成前）

```bash
chmod +x examples/**/*.sh examples/*.sh
./examples/01_setup/01_install.sh  # ～ 06_registry の各カテゴリを実行
./examples/07_clean.sh
```

### 4. release/* → develop

```bash
gh pr create --base develop --head release/x.y.z --title "Release x.y.z: <概要>" --body "..."
gh pr checks <PR番号> --watch  # CI全pass確認
gh pr merge <PR番号> --merge   # ← ユーザー指示を待つ
```

### 5. develop → main

```bash
gh pr create --base main --head develop --title "Release x.y.z" --body "..."
gh pr checks <PR番号> --watch
gh pr merge <PR番号> --merge   # ← ユーザー指示を待つ。mainマージでJSR publish自動実行
```

### 6. vtag作成 & クリーンアップ

```bash
git fetch origin main
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
