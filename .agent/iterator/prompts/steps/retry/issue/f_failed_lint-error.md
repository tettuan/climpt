## リントエラーがあります

完了条件を満たすには、すべてのリントエラーを解消する必要があります。

{{#if errors}}

### エラー一覧

{{#each errors}}

- `{{this.file}}:{{this.line}}` ({{this.rule}}): {{this.message}} {{/each}}
  {{/if}}

{{#if files}}

### 対象ファイル

{{#each files}}

- `{{this}}` {{/each}} {{/if}}

リントエラーを修正してください。

**手順:**

1. エラーメッセージとルールを確認
2. 該当箇所のコードを修正
3. `deno task lint` で再度確認

## Allowed `next_action.action` values

This retry prompt is fed back into the failing step. Your structured JSON
response MUST satisfy that step's `next_action.action` enum:

- `closure.issue` → `["closing","repeat"]`. Emit `repeat` after fixing the lint
  errors so validation re-runs.
- `closure.issue.precheck-*` → `["next","repeat"]`. Emit `repeat` after fixing
  the lint errors.

Do NOT emit `handoff`, `close`, `done`, or any other value. Any value outside
the allowed enum for the failing step triggers `GATE_INTERPRETATION_ERROR`
(failFast) and aborts the run. Canonical schema:
`.agent/iterator/schemas/issue.schema.json`.
