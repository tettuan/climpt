---
name: examples-smoke-test
description: Use when examples/ pipeline fails, hangs, or produces unexpected results. Troubleshoot by isolating the Runner from the pipeline with a smoke test. Trigger words - 'examples 失敗', 'examples hang', 'run-all.sh failed', 'examples troubleshoot', 'examples 問題', 'pipeline stopped', 'step failed', 'agent が動かない', 'examples デバッグ'.
allowed-tools: [Bash, Read, Write, Grep, Glob, Agent]
---

# Examples Smoke Test

examples/ パイプラインの問題切り分け手法。
Runner を直接コールして「煙が出ないか」確認する。

## 思考プロセス

### 1. 問題の層を特定する

examples/ の失敗は 2 層に分かれる。まず「どちらの層か」を判断する。

- **パイプライン層**: run-all.sh → run.sh → 前提条件チェック → 環境変数
- **Runner 層**: run-agent.ts → 設定読込 → prompt 解決 → SDK query → verdict

Smoke test は Runner 層だけを検証する。PASS ならパイプライン層、FAIL なら Runner 層に問題がある。

### 2. Smoke Test を実行する

Runner を最小構成で直接コールし、成功するか確認する。
具体的な手順は [smoke-test-execution.md](./refs/smoke-test-execution.md) を参照。

### 3. 結果から原因を絞り込む

Smoke Test の結果と失敗症状の組み合わせで原因カテゴリを絞る。

**PASS (Runner 正常) の場合** — パイプライン側を疑う:
- 設定ファイルの不在・不整合
- 環境変数の汚染 (Claude Code ネスト等)
- run.sh の前提条件チェックによる早期 exit
- permissionMode による UI ブロック

**FAIL (Runner 異常) の場合** — agents/ 側を疑う:
- prompt 解決チェーン (breakdown → fallback) の破損
- SDK バージョン不整合
- agent.json schema 不正
- query-executor のエラー飲み込み

症状と原因の詳細な対応表は [troubleshooting-matrix.md](./refs/troubleshooting-matrix.md) を参照。

### 4. 検証範囲を意識する

Smoke test が検証するのは Runner 内部のみ。以下は検証外:
- run-all.sh のループ制御・失敗伝播
- run.sh の前提条件チェック (check_llm_ready, check_deno)
- breakdown config の存在 (smoke test が自前で作るため)

「Smoke PASS なのにパイプラインで失敗する」は正常な結果。パイプライン層の調査に切り替える。

### 5. 環境差異を考慮する

実行環境によって挙動が変わる。特に Claude Code 内からの実行はネスト制約がある。
環境別の注意点は [environment-notes.md](./refs/environment-notes.md) を参照。

## 関連リソース

- テストスクリプト: `examples/scripts/test-runner-minimal.ts`
- パイプライン全体: `examples/CLAUDE.md`
- Runner 設計: `/agents-overview` skill
