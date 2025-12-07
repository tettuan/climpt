---
c1: climpt-git
c2: merge-up
c3: base-branch
title: 作業ブランチ間のマージ処理
description: 作業ブランチから派生した作業ブランチを、元の作業ブランチへマージする
usage: climpt-git merge-up base-branch
c3l_version: "0.5"
options:
  edition: ["default"]
  adaptation: ["default"]
  file: false
  stdin: false
  destination: false
---
# 指示書: 作業ブランチ間のマージ処理

これは指示書である。
現在のブランチについて、以下のマージ処理をする。

# マージ手順

0. `climpt-commit semantic units` を実行し、指示に従う（未コミットファイルを全てコミットする）
1. 変更をpushする
2. 現在のブランチを把握する(branch-B)
3. 「実際の分岐元ブランチ」を特定する（branch-A）
4. branch-A のブランチに対し、branch-B の変更がマージ可能か調べる（判定結果BtoA）
5. 判定結果BtoAがTrueの時: gh で branch-A への branch-B のマージPRを作成する。判定結果BtoAがFalseの時、エラーを伝え作業を終了する
6. PRを作成した場合、gh で作成したPRをghでマージする
7. マージが成功したら、branch-Bを削除する
7-1. 他にもマージ済みで削除できるブランチがあれば削除する
8. 作業ブランチを branch-A であることを確認し、作業終了する

# 実際の分岐元ブランチの特定方法

## 定義
「実際の分岐元ブランチ」とは、現在のブランチが `git checkout -b` または `git branch` で作成された時点で、
作業していたブランチ（HEAD が指していたブランチ）を指す。

## 特定手順

### 手順1: reflog から作成時の情報を取得
```bash
git reflog show <branch-B> | grep "branch: Created from"
```
これで以下のいずれかの情報が得られる：
- `branch: Created from HEAD` - HEADから作成
- `branch: Created from <branch-name>` - 特定のブランチから作成

### 手順2: HEADから作成された場合の分岐元特定

1. **分岐点のコミットハッシュを取得**
```bash
git rev-list --max-parents=0 <branch-B> | tail -1
# または
git merge-base <branch-B> $(git branch -r | grep -v HEAD | sed 's/origin\///')
```

2. **そのコミットを含む全ブランチを取得**
```bash
BRANCH_COMMIT=$(git rev-list --max-parents=0 <branch-B> | tail -1)
git branch --contains $BRANCH_COMMIT
```

3. **ブランチ作成時のタイムスタンプを確認**
```bash
# reflog から作成時刻を取得
CREATED_TIME=$(git reflog show <branch-B> --date=iso | grep "branch: Created" | awk '{print $2, $3}')
```

4. **作成時刻直前の HEAD の位置を確認**
```bash
# 作成時刻直前の HEAD がどのブランチにいたか
git reflog --date=iso | grep -B5 "$CREATED_TIME" | grep "checkout: moving from"
```

### 手順3: ブランチ階層による推定

もし上記で特定できない場合、ブランチ名の命名規則から推定：

```bash
# 現在のブランチ名を解析
CURRENT_BRANCH=<branch-B>

# ケース1: サブブランチの場合 (例: feat/api-oauth → feat/api-oauth-router)
# 前方一致で最も長く一致するブランチを探す
git branch | while read branch; do
  if [[ "$CURRENT_BRANCH" == "$branch"* ]] && [[ "$branch" != "$CURRENT_BRANCH" ]]; then
    echo "$branch"
  fi
done | sort -r | head -1

# ケース2: 同一プレフィックスのブランチ群から (例: feat/*)
# 同じプレフィックスで、作成時刻が最も近い先行ブランチを探す
PREFIX=$(echo $CURRENT_BRANCH | cut -d'/' -f1)
git for-each-ref --format='%(refname:short) %(committerdate:iso)' refs/heads/$PREFIX/* | 
  grep -v "$CURRENT_BRANCH" |
  awk -v created="$CREATED_TIME" '$2 " " $3 < created' |
  sort -k2,3 -r | head -1 | awk '{print $1}'
```

### 手順4: 最終的な決定ロジック

```bash
# 優先順位に従って分岐元を決定
determine_parent_branch() {
  local current_branch=$1
  
  # 1. reflog に明示的な記録がある場合
  local explicit_parent=$(git reflog show $current_branch | grep "branch: Created from" | sed 's/.*Created from //' | grep -v HEAD)
  if [[ -n "$explicit_parent" ]]; then
    echo "$explicit_parent"
    return
  fi
  
  # 2. checkout 履歴から特定
  local checkout_from=$(git reflog --date=iso | grep -B1 "checkout:.*to $current_branch" | grep "checkout: moving from" | head -1 | sed 's/.*moving from \([^ ]*\).*/\1/')
  if [[ -n "$checkout_from" ]] && [[ "$checkout_from" != "$current_branch" ]]; then
    echo "$checkout_from"
    return
  fi
  
  # 3. ブランチ名の階層構造から推定
  local hierarchical_parent=$(find_hierarchical_parent $current_branch)
  if [[ -n "$hierarchical_parent" ]]; then
    echo "$hierarchical_parent"
    return
  fi
  
  # 4. 最後の手段：develop（ただし警告を出す）
  echo "WARNING: Could not determine exact parent branch, defaulting to develop" >&2
  echo "develop"
}
```

## 分岐元ブランチの検証

特定した分岐元ブランチが妥当かを検証：

1. **分岐元ブランチが存在するか確認**
```bash
git show-ref --verify --quiet refs/heads/<branch-A>
```

2. **分岐点が分岐元ブランチに含まれるか確認**
```bash
MERGE_BASE=$(git merge-base <branch-A> <branch-B>)
git branch --contains $MERGE_BASE | grep -q "^[* ]*<branch-A>$"
```

3. **ブランチ階層が論理的か確認**
- `feat/` → `develop` または他の `feat/`
- `fix/` → `develop` または関連する `feat/`
- `test/` → テスト対象のブランチ
- `refactor/` → リファクタリング対象のブランチ

# 例

## 例1: 明示的な分岐
```
develop:   A -- B -- C
feat/api:            C -- D -- E
feat/api-auth:                  E -- F -- G

feat/api-auth の分岐元 → feat/api（reflog または階層構造から特定）
```

## 例2: 暗黙的な分岐
```
develop:   A -- B -- C -- D
feat/user:           C -- E -- F
test/user-test:            E -- G -- H

test/user-test の分岐元 → feat/user（ブランチ名から推定）
```

# PRのコメント

200文字程度にする（長すぎるとエラーになる）
英語でメッセージを作成する。

分岐元の特定方法も含める：
```
Merge <branch-B> back to <branch-A>
Parent branch determined by: [reflog|checkout history|naming hierarchy]
Changes: <brief summary>
```