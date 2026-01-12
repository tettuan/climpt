## 未コミットの変更があります

完了条件を満たすには、すべての変更をコミットする必要があります。

{{#if changedFiles}}
### 変更ファイル
{{#each changedFiles}}
- `{{this}}`
{{/each}}
{{/if}}

{{#if untrackedFiles}}
### 未追跡ファイル
{{#each untrackedFiles}}
- `{{this}}`
{{/each}}
{{/if}}

適切なコミットメッセージで変更をコミットしてください。

**手順:**
1. `git add .` で変更をステージング
2. `git commit -m "適切なメッセージ"` でコミット
