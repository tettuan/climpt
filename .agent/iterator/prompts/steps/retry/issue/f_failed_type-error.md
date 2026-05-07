## 型エラーがあります

完了条件を満たすには、すべての型エラーを解消する必要があります。

{{#if errors}}

### エラー一覧

{{#each errors}}

- `{{this.file}}:{{this.line}}`: {{this.message}} {{/each}} {{/if}}

{{#if files}}

### 対象ファイル

{{#each files}}

- `{{this}}` {{/each}} {{/if}}

型エラーを修正してください。

**手順:**

1. エラーメッセージを確認
2. 該当箇所の型定義を修正
3. `deno check` で再度確認

## Allowed `next_action.action` values

This retry prompt is fed back into `closure.issue` (the validator `type-check`
runs there). Your structured JSON response MUST satisfy that step's
`next_action.action` enum:

- Allowed values: `["closing","repeat"]`
- After fixing the type errors, emit `repeat` so the validator re-runs and
  confirms `deno check` passes.

Do NOT emit `next`, `handoff`, `close`, `done`, or any other value. Any value
outside `["closing","repeat"]` triggers `GATE_INTERPRETATION_ERROR` (failFast)
and aborts the run. Canonical schema:
`.agent/iterator/schemas/issue.schema.json` →
`closure.issue.properties.next_action.properties.action.enum`.
