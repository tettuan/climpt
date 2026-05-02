## テストが失敗しています

完了条件を満たすには、すべてのテストを通過させる必要があります。

{{#if failedTests}}

### 失敗したテスト

{{#each failedTests}}

- `{{this.name}}`: {{this.error}} {{/each}} {{/if}}

{{#if errorOutput}}

### エラー出力

```
{{errorOutput}}
```

{{/if}}

失敗したテストを確認し、コードを修正してください。

**ヒント:**

- エラーメッセージを読んで、失敗の原因を特定する
- 必要に応じて実装を修正する
- `deno task test` で再度テストを実行して確認

## Allowed `next_action.action` values

This retry prompt is fed back into the failing step. Your structured JSON
response MUST satisfy that step's `next_action.action` enum:

- `closure.issue` → `["closing","repeat"]`. Emit `repeat` after fixing the
  failing tests so validation re-runs.
- `closure.issue.precheck-*` → `["next","repeat"]`. Emit `repeat` after fixing
  the failing tests.

Do NOT emit `handoff`, `close`, `done`, or any other value. Any value outside
the allowed enum for the failing step triggers `GATE_INTERPRETATION_ERROR`
(failFast) and aborts the run. Canonical schema:
`.agent/iterator/schemas/issue.schema.json`.
