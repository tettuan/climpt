## 未コミットの変更があります

完了条件を満たすには、すべての変更をコミットする必要があります。

{{#if changedFiles}}

### 変更ファイル

{{#each changedFiles}}

- `{{this}}` {{/each}} {{/if}}

{{#if untrackedFiles}}

### 未追跡ファイル

{{#each untrackedFiles}}

- `{{this}}` {{/each}} {{/if}}

適切なコミットメッセージで変更をコミットしてください。

**手順:**

1. `git add .` で変更をステージング
2. `git commit -m "適切なメッセージ"` でコミット

## Allowed `next_action.action` values

This retry prompt is fed back into `closure.issue` (the validator `git-clean`
runs there). Your structured JSON response MUST satisfy that step's
`next_action.action` enum:

- Allowed values: `["closing","repeat"]`
- After committing the working-tree changes, emit `repeat` so the validator
  re-runs and confirms `git status --porcelain` is empty.

Do NOT emit `next`, `handoff`, `close`, `done`, or any other value. Any value
outside `["closing","repeat"]` triggers `GATE_INTERPRETATION_ERROR` (failFast)
and aborts the run. Canonical schema:
`.agent/iterator/schemas/issue.schema.json` →
`closure.issue.properties.next_action.properties.action.enum`.
