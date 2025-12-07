---
c1: climpt-git
c2: find-oldest
c3: descendant-branch
title: Git関連ブランチ探索とマージ処理実行
description: 現在のブランチから派生した子孫・兄弟ブランチを探索し、最古の関連ブランチをマージ処理する
usage: climpt-git find-oldest descendant-branch
c3l_version: "0.5"
options:
  edition: ["default"]
  adaptation: ["default", "detailed"]
  file: false
  stdin: false
  destination: false
---

# 指示書:Git関連ブランチ探索とマージ処理実行

この指示に従い、処理して。

## 概要
現在のGitブランチから派生した子孫ブランチと、同じ親から派生した兄弟ブランチを探索し、最も古い関連ブランチの作業状態を確認する。作業が完了している場合は、そのブランチを元の親ブランチへマージするための処理を実行する。

## 前提情報
- **対象**: Gitバージョン管理されたリポジトリ
- **ブランチ戦略**: feat/, fix/, test/, docs/, refactor/, chore/, perf/, ci/, build/, revert/等
- **命名規則**: `<type>/<description>-YYYYMMDD-HHMM` 形式（例: test/histories-view-cleanup-20250816-0927）
- **環境**: climpt-gitコマンドが利用可能な開発環境

## 手順

### 1. リモート情報の同期
```bash
git fetch --all --prune
```
リモートブランチ情報を最新化し、削除されたブランチを整理する。
merge済のブランチは削除してクリーンにする。

### 2. 関連ブランチの包括探索
現在のブランチに関連するすべてのブランチ（子孫・兄弟）を特定する。

**A. 子孫ブランチ探索**:
```bash
# 現在のブランチから派生したブランチ
git branch -a --contains HEAD | grep -E '(feat|fix|test|docs|refactor|chore|perf|ci|build|revert)/' | grep -v "$(git branch --show-current)"
```

**B. 兄弟ブランチ探索**:
```bash
# 共通の親ブランチを特定
parent_commit=$(git merge-base HEAD develop 2>/dev/null || git merge-base HEAD main)

# 同じ親から派生した兄弟ブランチ
git branch -a --contains $parent_commit | grep -E '(feat|fix|test|docs|refactor|chore|perf|ci|build|revert)/' | grep -v "$(git branch --show-current)" | while read branch; do
  # 現在のブランチのコミットを含まない（兄弟判定）
  if ! git merge-base --is-ancestor HEAD $(echo $branch | sed 's|.*origin/||' | sed 's|^  ||'); then
    echo $branch
  fi
done
```

**判定ロジック**:
- **子孫**: 現在のブランチのコミットを含む AND 現在のブランチ≠対象
- **兄弟**: 共通の親を持つ AND 現在のブランチのコミットを含まない
- ブランチ名が規定のプレフィックスパターンに一致

### 3. 最古の関連ブランチの特定と優先順位
**優先順位ルール**:
1. **子孫ブランチ優先** - 現在の作業の延長なので最優先
2. **兄弟ブランチ** - 並列開発なので次点
3. **タイムスタンプ順** - 同カテゴリ内では最古から処理

**タイムスタンプ解析**:
```bash
# 子孫・兄弟ブランチを統合してタイムスタンプ順にソート
{
  # 子孫ブランチ（優先度: 1）
  子孫ブランチ一覧 | while read branch; do
    timestamp=$(echo $branch | grep -o '[0-9]\{8\}-[0-9]\{4\}' || echo "99999999-9999")
    echo "1 $timestamp $branch"
  done
  
  # 兄弟ブランチ（優先度: 2）
  兄弟ブランチ一覧 | while read branch; do
    timestamp=$(echo $branch | grep -o '[0-9]\{8\}-[0-9]\{4\}' || echo "99999999-9999")
    echo "2 $timestamp $branch"
  done
} | sort -k1,1n -k2,2n | head -1
```

**特定基準**:
1. 優先度（1=子孫, 2=兄弟）→ タイムスタンプ順でソート
2. ブランチ名からタイムスタンプ（YYYYMMDD-HHMM）を抽出
3. タイムスタンプがない場合は最後尾に配置（99999999-9999）

### 4. 作業状態の確認
**検証項目**:
```bash
# 未コミット変更の確認
git status --porcelain

# リモート同期状態の確認
git rev-list --count HEAD..origin/$(git branch --show-current) 2>/dev/null || echo "0"

# マージ可能性の確認
git merge-base --is-ancestor HEAD target_branch; echo $?
```

**完了判定基準**:
- すべての変更がコミット済み（status --porcelain が空）
- リモートブランチと同期済み
- マージ先ブランチと競合なし

### 5. 親ブランチの特定
**特定方法**:
```bash
# 分岐点の特定
git merge-base HEAD target_branch

# 分岐点を含むブランチの列挙
git branch -a --contains $(git merge-base HEAD target_branch)
```

### 6. マージ処理の実行
**実行条件確認後**:
```bash
climpt-git merge-up base-branch
```

**禁止事項**:
- develop や main への直接マージ
- 作業未完了ブランチのマージ
- 強制マージ（--force）の使用
- 兄弟ブランチ同士の直接マージ

### 7. 兄弟ブランチ特有の考慮事項
**競合リスク管理**:
```bash
# 兄弟ブランチとの競合チェック
git merge-tree $(git merge-base HEAD sibling_branch) HEAD sibling_branch

# 共通ファイル変更の検出
git diff $(git merge-base HEAD sibling_branch)..HEAD --name-only > current_files
git diff $(git merge-base HEAD sibling_branch)..sibling_branch --name-only > sibling_files
comm -12 current_files sibling_files  # 共通変更ファイル
```

**処理戦略**:
- 兄弟ブランチマージ前に親ブランチからrebaseを推奨
- 競合するファイルがある場合は手動確認を促す

## エラーハンドリング
- コンフリクト発生時: 詳細情報を表示して手動解決を促す
- マージ失敗時: `git merge --abort` でロールバック
- 兄弟ブランチ競合時: rebase推奨メッセージを表示

## 成果物
- 関連ブランチ一覧レポート（子孫・兄弟の分類付き）
- 最古関連ブランチの特定結果
- マージ実行ログまたは実行不要判定
- 兄弟ブランチ競合リスク報告

## 完了条件（DoD）
1. 子孫・兄弟ブランチの包括的探索完了
2. 優先順位付きソート完了
3. 最古の関連ブランチ特定完了
4. 兄弟ブランチ競合リスク評価完了
5. マージ処理実行または実行不要判定完了

## 実行例
```bash
# 1. リモート同期
git fetch --all --prune

# 2. 関連ブランチ探索（子孫・兄弟）
descendant_branches=$(git branch -a --contains HEAD | grep -E '(feat|fix|test)/' | grep -v "$(git branch --show-current)")
parent_commit=$(git merge-base HEAD develop 2>/dev/null || git merge-base HEAD main)
sibling_branches=$(git branch -a --contains $parent_commit | grep -E '(feat|fix|test)/' | grep -v "$(git branch --show-current)" | while read b; do
  if ! git merge-base --is-ancestor HEAD $(echo $b | sed 's|.*origin/||'); then echo $b; fi
done)

# 3. 優先順位付きソートと最古特定
{
  echo "$descendant_branches" | while read branch; do
    ts=$(echo $branch | grep -o '[0-9]\{8\}-[0-9]\{4\}' || echo "99999999-9999")
    echo "1 $ts $branch"
  done
  echo "$sibling_branches" | while read branch; do
    ts=$(echo $branch | grep -o '[0-9]\{8\}-[0-9]\{4\}' || echo "99999999-9999")
    echo "2 $ts $branch"
  done
} | sort -k1,1n -k2,2n | head -1

# 4. マージ処理
climpt-git merge-up base-branch
```

## 参照資料
- **プロジェクト規約**: `docs/claude/git-workflow.md`
- **ブランチ命名規則**: Conventional Branches

# 作業指示

上述の指示に従い、処理して。
