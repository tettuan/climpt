---
params:
  - branchName
  - remoteStatus
---

## ブランチがリモートにプッシュされていません

### 現在のブランチ

`{{branchName}}`

### 状況

リモートリポジトリにプッシュされていません。

### 対応

1. 変更をコミットしてください
2. リモートにプッシュしてください: `git push -u origin {{branchName}}`

プッシュが完了したら、再度完了を宣言してください。

## Allowed `next_action.action` values

This retry prompt is fed back into the failing step. Your structured JSON
response MUST satisfy that step's `next_action.action` enum:

- `closure.issue` → `["closing","repeat"]`. Emit `repeat` after pushing so
  validation re-runs.
- `closure.issue.precheck-*` → `["next","repeat"]`. Emit `repeat` after pushing.

Do NOT emit `handoff`, `close`, `done`, or any other value. Any value outside
the allowed enum for the failing step triggers `GATE_INTERPRETATION_ERROR`
(failFast) and aborts the run. Canonical schema:
`.agent/iterator/schemas/issue.schema.json`.
