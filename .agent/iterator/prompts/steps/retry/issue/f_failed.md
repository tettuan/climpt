## 完了条件が満たされていません

Step の完了条件を確認した結果、いくつかの問題が検出されました。

{{#if error}}

### エラー内容

```
{{error}}
```

{{/if}}

{{#if details}}

### 詳細

{{#each details}}

- {{this}} {{/each}} {{/if}}

問題を解決して、再度完了を試みてください。

## Allowed `next_action.action` values

This is a generic retry prompt fed back into the failing step. Your structured
JSON response MUST satisfy that step's `next_action.action` enum:

- `closure.issue` (default closure, validators `git-clean` / `type-check`) →
  MUST be one of `["closing","repeat"]`. Emit `repeat` after remediation to
  re-trigger validation.
- `closure.issue.precheck-*` (commit-verify / ac-verify / kind-scope) → MUST be
  one of `["next","repeat"]`. Emit `repeat` after remediation.

Do NOT emit `handoff`, `close`, `done`, or any other value. Any value outside
the allowed enum for the failing step triggers `GATE_INTERPRETATION_ERROR`
(failFast) and aborts the run. Canonical schema:
`.agent/iterator/schemas/issue.schema.json`.
