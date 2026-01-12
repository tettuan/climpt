## 必要なファイルが存在しません

完了条件を満たすには、必要なファイルを作成する必要があります。

{{#if missingFiles}}
### 不足しているファイル
{{#each missingFiles}}
- `{{this}}`
{{/each}}
{{/if}}

{{#if expectedPath}}
### 期待されるパス
`{{expectedPath}}`
{{/if}}

必要なファイルを作成してください。
