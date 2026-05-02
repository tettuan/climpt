## フォーマットエラーがあります

完了条件を満たすには、コードを正しくフォーマットする必要があります。

{{#if files}}

### フォーマットが必要なファイル

{{#each files}}

- `{{this}}` {{/each}} {{/if}}

{{#if diff}}

### 差分

```
{{diff}}
```

{{/if}}

コードをフォーマットしてください。

**手順:**

1. `deno fmt` を実行してフォーマット
2. 変更を確認
3. 必要に応じてコミット

## Allowed `next_action.action` values

This retry prompt is fed back into the failing step. Your structured JSON
response MUST satisfy that step's `next_action.action` enum:

- `closure.issue` → `["closing","repeat"]`. Emit `repeat` after running
  `deno fmt` and committing so validation re-runs.
- `closure.issue.precheck-*` → `["next","repeat"]`. Emit `repeat` after running
  `deno fmt` and committing.

Do NOT emit `handoff`, `close`, `done`, or any other value. Any value outside
the allowed enum for the failing step triggers `GATE_INTERPRETATION_ERROR`
(failFast) and aborts the run. Canonical schema:
`.agent/iterator/schemas/issue.schema.json`.
