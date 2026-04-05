# リリース トラブルシューティング

| 症状 | 対処 |
|:--|:--|
| JSR publishスキップ | deno.jsonバージョンが既存と同一。上げて再リリース |
| CIバージョンチェック失敗 | deno.json・version.ts・ブランチ名を統一してcommit & push |
| vtagが古いコミット | `git tag -d vx.y.z && git push origin :refs/tags/vx.y.z` 後に再作成 |
| リモートCI待機タイムアウト | `gh run list` で確認、`gh run rerun <run-id>` |
| 前バージョンのタグ欠落 | 前バージョンの vtag を先に作成してから再開 |
