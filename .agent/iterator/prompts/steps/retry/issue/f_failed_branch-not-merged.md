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

## Allowed `next_action.action` values

This retry prompt is fed back into the failing step. Your structured JSON
response MUST satisfy that step's `next_action.action` enum:

- `closure.issue` → `["closing","repeat"]`. Emit `repeat` after the branch is
  merged so validation re-runs.
- `closure.issue.precheck-*` → `["next","repeat"]`. Emit `repeat` after the
  branch is merged.

Do NOT emit `handoff`, `close`, `done`, or any other value. Any value outside
the allowed enum for the failing step triggers `GATE_INTERPRETATION_ERROR`
(failFast) and aborts the run. Canonical schema:
`.agent/iterator/schemas/issue.schema.json`.
