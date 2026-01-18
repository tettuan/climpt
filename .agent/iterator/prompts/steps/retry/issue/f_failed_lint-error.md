## リントエラーがあります

完了条件を満たすには、すべてのリントエラーを解消する必要があります。

{{#if errors}}
### エラー一覧
{{#each errors}}
- `{{this.file}}:{{this.line}}` ({{this.rule}}): {{this.message}}
{{/each}}
{{/if}}

{{#if files}}
### 対象ファイル
{{#each files}}
- `{{this}}`
{{/each}}
{{/if}}

リントエラーを修正してください。

**手順:**
1. エラーメッセージとルールを確認
2. 該当箇所のコードを修正
3. `deno task lint` で再度確認
