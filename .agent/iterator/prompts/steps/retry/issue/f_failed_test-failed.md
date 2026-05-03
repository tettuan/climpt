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

This retry prompt is fed back into `closure.issue` (the validator `tests-pass`
runs there). Your structured JSON response MUST satisfy that step's
`next_action.action` enum:

- Allowed values: `["closing","repeat"]`
- After fixing the failing tests, emit `repeat` so the validator re-runs and
  confirms `deno task test` exits with code 0.

Do NOT emit `next`, `handoff`, `close`, `done`, or any other value. Any value
outside `["closing","repeat"]` triggers `GATE_INTERPRETATION_ERROR` (failFast)
and aborts the run. Canonical schema:
`.agent/iterator/schemas/issue.schema.json` →
`closure.issue.properties.next_action.properties.action.enum`.
