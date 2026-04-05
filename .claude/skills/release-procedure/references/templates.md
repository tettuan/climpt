# 共通テンプレート

Task 6/9（リモートCI待機）および Task 7/10（マージ & 検証）で共通。
`{pr_head}` と `{base}` を実際の値に置換して実行する。

## テンプレート: リモートCI待機

```bash
PR_NUM=$(gh pr view {pr_head} --json number -q .number)
gh pr checks "$PR_NUM" --watch
```
全 check pass → 次タスクへ。いずれか fail → ABORT（失敗内容を報告）。

## テンプレート: マージ & 検証

```bash
gh pr merge "$PR_NUM" --merge
```

Post-condition:
```bash
git fetch origin
VER=x.y.z
gh pr view "$PR_NUM" --json state -q .state | grep -q "MERGED" || { echo "ABORT: PR not merged"; exit 1; }
git show origin/{base}:deno.json | grep -q "\"version\": \"$VER\"" || { echo "ABORT: {base} version mismatch"; exit 1; }
```
