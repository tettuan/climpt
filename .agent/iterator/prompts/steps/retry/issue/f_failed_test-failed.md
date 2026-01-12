## テストが失敗しています

完了条件を満たすには、すべてのテストを通過させる必要があります。

{{#if failedTests}}
### 失敗したテスト
{{#each failedTests}}
- `{{this.name}}`: {{this.error}}
{{/each}}
{{/if}}

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
