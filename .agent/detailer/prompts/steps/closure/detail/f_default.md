---
stepId: detail
name: Detail Implementation Spec
description: Single-iteration — read considerer comment, compose spec, post one comment.
uvVariables:
  - issue
---

# Task: Detail issue #{uv-issue}

単一反復で、考察コメントを実装仕様コメントに変換して投稿する。コードは
変更しない。Issue のクローズ/ラベル変更は行わない。

## Step 1 — Read the issue and considerer comment

```bash
gh issue view {uv-issue} --json number,title,body,labels,author,comments
```

Extract:

- Issue 本文 (`body`) — 要件・背景・前提条件
- `comments[]` のうち、本文が `## 検討結果` で始まる **最新** の considerer
  コメント。これが仕様化の主入力。
- `comments[]` の他の補足コメント (議論・追加要件)

もし considerer コメントが存在しない、または `### 次アクション` が
`handoff-detail` で終わっていない場合は、`verdict = "blocked"` 候補。

## Step 2 — Research the codebase

考察コメントが指し示す anchor (file / symbol / strategy) を検証する。

- `Glob` / `Grep` で対象ファイルが存在することを確認
- `Read` で対象関数/型の現状を把握し、変更対象として適切かを判定
- 関連する既存パターンを `Grep` で探索 (同種の処理、テスト戦略)
- 不足している場合のみ `Task` サブエージェントに深掘り調査を委譲
- 外部仕様の参照が必要なときだけ `WebFetch` を使う

全ての参照は **読み取り専用**。`Edit` / `Write` / `NotebookEdit` 使用禁止。

## Step 3 — Compose the Implementation Spec

`$TMPDIR/detailer-{uv-issue}.md` に仕様書を書き出す。system prompt の
テンプレートに厳密に従うこと。

### handoff-impl の場合 (5 セクション全て具体)

```markdown
## Implementation Spec

### Summary
<1-2 行>

### Changes
- **Files**: path:line 形式で具体的に
- **Functions / Lines**: symbol at file:L始-L終

### Approach
<既存パターンへの参照を含む具体的な方針>

### Acceptance Criteria
- [ ] <観測可能な条件>
- [ ] <観測可能な条件>

### Test Plan
- <テスト観点と対象>
```

### blocked の場合 (仕様化不能)

```markdown
## Implementation Spec

### Blocked
<理由を 1-3 文で。不足情報と、何があれば解決できるかを明記>
```

判定基準は system prompt の "Verdict decision criteria" に従う。

## Step 4 — Post the comment (exactly one)

```bash
gh issue comment {uv-issue} --body-file "$TMPDIR/detailer-{uv-issue}.md"
```

返却される Issue コメント URL を記録する (`handoff-impl` のときは structured
output の `spec_comment_url` に入れる)。

**禁止**:

- `gh issue close` 実行禁止 — orchestrator が行う。
- `gh issue edit --add-label` / `--remove-label` 実行禁止 — orchestrator が
  `workflow.json` labelMapping で制御する。
- コメント投稿後の再編集 / 複数投稿禁止。

## Step 5 — Emit structured output

closure step の structured output として以下を返す。

### handoff-impl の場合

```json
{
  "stepId": "detail",
  "status": "completed",
  "summary": "Posted Implementation Spec for issue #{uv-issue} covering <対象>.",
  "next_action": { "action": "closing" },
  "verdict": "handoff-impl",
  "closure_action": "label-only",
  "issue": { "labels": { "add": [], "remove": [] } },
  "detail_summary": "<1 段落で仕様の要旨 — iterator への引継ぎ要約>",
  "spec_comment_url": "<Step 4 で取得したコメント URL>",
  "blocked_reason": null
}
```

### blocked の場合

```json
{
  "stepId": "detail",
  "status": "completed",
  "summary": "Blocked: cannot specify issue #{uv-issue} (<短い理由>).",
  "next_action": { "action": "closing" },
  "verdict": "blocked",
  "closure_action": "label-only",
  "issue": { "labels": { "add": [], "remove": [] } },
  "detail_summary": "<1 段落で何が不足しているか、解決条件は何か>",
  "spec_comment_url": "<Blocked コメント URL or null>",
  "blocked_reason": "<具体的な不能理由>"
}
```

## Step 6 — Final status line

最後に単一行でステータスを出力する。

```
detailer: <verdict> #{uv-issue} (<spec 投稿 or blocked 理由>)
```

例:

- `detailer: handoff-impl #42 (spec posted: https://github.com/.../issues/42#issuecomment-123)`
- `detailer: blocked #42 (no considerer comment with concrete anchor)`

途中のいずれかで失敗した場合は、失敗した step と `gh` コマンドの完全な
出力を報告し、silently retry しない。`gh issue close` / ラベル変更は絶対に
実行しない。
