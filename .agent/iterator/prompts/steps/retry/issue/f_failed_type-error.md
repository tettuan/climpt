## 型エラーがあります

完了条件を満たすには、すべての型エラーを解消する必要があります。

{{#if errors}}
### エラー一覧
{{#each errors}}
- `{{this.file}}:{{this.line}}`: {{this.message}}
{{/each}}
{{/if}}

{{#if files}}
### 対象ファイル
{{#each files}}
- `{{this}}`
{{/each}}
{{/if}}

型エラーを修正してください。

**手順:**
1. エラーメッセージを確認
2. 該当箇所の型定義を修正
3. `deno task check` で再度確認
