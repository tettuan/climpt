## 必要なファイルが存在しません

完了条件を満たすには、必要なファイルを作成する必要があります。

{{#if missingFiles}}

### 不足しているファイル

{{#each missingFiles}}

- `{{this}}` {{/each}} {{/if}}

{{#if expectedPath}}

### 期待されるパス

`{{expectedPath}}` {{/if}}

必要なファイルを作成してください。

## Allowed `next_action.action` values

This retry prompt is fed back into the failing step. Your structured JSON
response MUST satisfy that step's `next_action.action` enum:

- `closure.issue` → `["closing","repeat"]`. Emit `repeat` after creating the
  missing file so validation re-runs.
- `closure.issue.precheck-*` → `["next","repeat"]`. Emit `repeat` after creating
  the missing file.

Do NOT emit `handoff`, `close`, `done`, or any other value. Any value outside
the allowed enum for the failing step triggers `GATE_INTERPRETATION_ERROR`
(failFast) and aborts the run. Canonical schema:
`.agent/iterator/schemas/issue.schema.json`.
