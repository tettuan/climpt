# 問題の切り分けマトリクス

Smoke test の結果と step の失敗パターンで原因を絞る。

## Smoke PASS (Runner 正常) の場合

| 症状 | 原因 | 確認方法 |
|---|---|---|
| breakdown prompt 解決失敗 | config yml 不在 | `ls .agent/climpt/config/{agent}-steps-*.yml` |
| UV variable missing | uvVariables と parameters の不一致 | steps_registry.json の uvVariables vs agent.json の parameters |
| step が即座に PASS | check_llm_ready が false → 早期 exit | `grep check_llm_ready examples/NN_*/run.sh` |
| step がハング | plan モードで承認 UI 待ち | agent.json の permissionMode を確認 |
| PASS だがエラーあり | run-all.sh が exit code を伝播しない | run-all.sh 末尾の `exit 1` 確認 |

## Smoke FAIL (Runner 異常) の場合

| 症状 | 原因 | 確認方法 |
|---|---|---|
| prompt 解決失敗 | C3L prompt file が存在しない | steps_registry.json の c2/c3/edition が prompts/ 配下のファイルと一致するか |
| SDK query エラー | SDK バージョン不整合 | `deno info --json \| grep claude-agent-sdk` |
| exit code 1 無出力 | agent.json schema 不正 | `run-agent.ts --validate --agent {name}` |
| success:true だがエラー | query-executor がエラーを飲み込む | tmp/logs/ のセッションログで errors 確認 |
