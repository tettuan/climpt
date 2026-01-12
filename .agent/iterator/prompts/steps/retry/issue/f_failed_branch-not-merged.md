---
params:
  - branchName
  - baseBranch
  - mergeStatus
---

## ブランチがマージされていません

### 現在のブランチ

`{{branchName}}`

### ベースブランチ

`{{baseBranch}}`

### 未マージのコミット

```
{{mergeStatus}}
```

### 対応

1. Pull Request を作成してください
2. レビューを依頼してください
3. マージが完了するまで待機してください

または、直接マージが許可されている場合:

```bash
git checkout {{baseBranch}}
git merge {{branchName}}
git push origin {{baseBranch}}
```

マージが完了したら、再度完了を宣言してください。
