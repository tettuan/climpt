---
c1: climpt-git
c2: list-select
c3: pr-branch
title: 現存のPRとブランチをリスト化して、次に作業する対象を選ぶ
description: List local and remote branches with PRs, then auto-select the next target to work on
usage: climpt-git list-select pr-branch
c3l_version: "0.5"
options:
  edition: ["default"]
  adaptation: ["default"]
  file: false
  stdin: false
  destination: false
---

# 指示: 現存のPRとブランチをリスト化して、次に作業する対象を選ぶ

## 目的
ローカル・リモートブランチとPRを一覧化し、次に作業すべき対象を自動選択する。
その選択に基づいて、次の作業を進める。

## 実行手順

### 1. ブランチ・PR情報収集
```bash
# ローカルブランチ一覧（現在ブランチをマーク）
git branch -v

# リモートブランチ一覧
git branch -r -v

# 未マージブランチ（developとの比較）
git branch --no-merged develop

# PR一覧（GitHub CLI使用）
gh pr list --state open --json number,title,headRefName,updatedAt,author,isDraft

# 現在ブランチの状態
git status --porcelain
```

### 2. 判断軸・優先度マトリクス

#### A. ブランチタイプ優先度（高→低）
1. `hotfix/*` - 本番緊急修正
2. `fix/*` - バグ修正
3. `feat/*` - 新機能開発
4. `refactor/*` - リファクタリング
5. `docs/*`, `test/*`, `chore/*` - その他

#### B. 状態評価基準
- **作業中断** (10pt): 未コミット変更がある
- **PR準備完了** (8pt): 未作成PRで開発完了
- **レビュー待ち** (6pt): OpenPRでレビュー未完了
- **マージ競合** (4pt): developとのコンフリクト
- **新規開始** (2pt): 新しいブランチ

#### C. 時間軸優先度
- **今日作成** (3pt): 24時間以内
- **今週作成** (2pt): 7日以内  
- **古いブランチ** (1pt): 7日超過

### 3. 選択アルゴリズム

#### 3.1 最優先チェック
```bash
# 作業中断があるか確認
if [[ -n "$(git status --porcelain)" ]]; then
    echo "PRIORITY: Continue current work on $(git branch --show-current)"
    exit 0
fi
```

#### 3.2 スコア計算
各ブランチに対して：
```
total_score = type_priority + status_score + time_score
```

#### 3.3 自動選択ルール
1. **Hotfix最優先**: `hotfix/*` ブランチは無条件で最優先
2. **PR作成待ち**: 開発完了でPR未作成は高優先度
3. **レビュー対応**: 自分のPRにコメントがあれば優先
4. **コンフリクト解決**: マージコンフリクトがあるブランチ
5. **継続開発**: 最新更新のfeatureブランチ

### 4. 出力フォーマット

#### 推奨アクション表示
```
=== RECOMMENDED ACTION ===
Target: feat/user-auth-20250816
Action: CREATE_PR
Reason: Development completed, ready for review
Score: 13 (type:5 + status:8 + time:3)

Next steps:
1. git checkout feat/user-auth-20250816
2. git push origin feat/user-auth-20250816
3. gh pr create --base develop
```

#### 全ブランチ一覧
```
=== ALL BRANCHES ANALYSIS ===
[HOTFIX] hotfix/security-fix-20250815     (Score: 15) - CRITICAL
[ACTIVE] feat/user-auth-20250816          (Score: 13) - READY_FOR_PR  
[REVIEW] feat/data-export-20250814        (Score: 11) - PR_REVIEW
[CONFLICT] fix/login-error-20250813       (Score: 9)  - MERGE_CONFLICT
[OLD] feat/analytics-20250801             (Score: 4)  - STALE
```

### 5. 特殊ケース処理

#### developブランチにいる場合
- 新しいfeatureブランチの作成を提案
- 未マージブランチから選択肢提示

#### PRマージ後処理
- ブランチ削除の提案
- 次の優先タスクへの移行

#### 長期ブランチ警告
- 7日以上古いブランチの整理提案
- developとの大幅な差分警告

## 注意事項
- PRはdevelopベースのみ（mainへの直接PRは禁止）
- 作業中ファイルがある場合は必ず保存・コミット確認
- hotfixブランチは例外的にmainからの派生を許可
- スコアが同点の場合は更新日時の新しい順で選択


# 作業指示

次の作業対象を選び、処理を決めて。
決めた作業を進めて。


