# Sub Agent Scope Policy (logs-analysis)

このスキルにおける sub agent 使用ポリシー。**解釈は sub agent に任せない**。

## 原則

1. **sub agent (Haiku/Sonnet/Task) に解釈をさせない**
   - 分類 (success / fail / partial)・verdict・RCA・相関分析・「なぜ」の推論は **すべて main (Opus)** で行う。
2. **Haiku の権限は「.ts を操作して場所を特定する」のみ**
   - 具体的には `index-logs.ts` の実行と stdout 返却。
   - それ以外 (digest 生成 / error 抽出 / 解釈) を Haiku に渡さない。
3. **Sonnet はこのスキルでは使わない**
   - 解釈が絡む cross-file reasoning も main が直接行う。mechanical な script 実行は main が Bash で回す。
4. **digest 生成は main が直接 Bash**
   - `summarize-*.ts` / `extract-errors.ts` は sub agent 経由にしない。stdout の JSON を main がそのまま解釈する。

## 役割マトリクス

| Task | 担当 | 備考 |
|------|------|------|
| `index-logs.ts` を実行して最新ファイル path を列挙 | Haiku sub agent (optional) / main | Haiku 使う場合は prompt に解釈要求を含めない |
| `summarize-orchestrator.ts` の実行 | **main** | sub agent 経由禁止 |
| `summarize-agent.ts` の実行 | **main** | sub agent 経由禁止 |
| `extract-errors.ts` の実行 | **main** | sub agent 経由禁止 |
| digest JSON の分類 (success/fail 判定) | **main** | Haiku に委譲しない |
| orchestrator × agent の相関・RCA | **main** | Sonnet に委譲しない |
| ユーザー向け最終判定・次アクション | **main** | 解釈の責任は main が持つ |

## Haiku 呼び出しの許容形

```typescript
// OK: script 実行して stdout を返すだけ
Task({
  subagent_type: "general-purpose",
  model: "haiku",
  description: "List recent orchestrator sessions",
  prompt:
    `次のコマンドを実行し、stdout の JSON をそのまま返してください。\n` +
    `解釈・要約・分類・判定は一切行わないでください。\n\n` +
    `cd <repo> && deno run -A .claude/skills/logs-analysis/scripts/index-logs.ts --category orchestrator --limit 5`,
});
```

## Haiku/Sonnet に **絶対に書かない** prompt パターン

- ✗ 「この digest を見て success/fail を判定してください」
- ✗ 「なぜ agent が止まったか推測してください」
- ✗ 「error pattern を分類してください」
- ✗ 「RCA をまとめてください」
- ✗ 「fix 提案を書いてください」
- ✗ 「要約してください」「important な event を選んでください」
- ✗ 「複数の digest を相関させてください」

これらは **すべて main (Opus) が自分で行う**。

## なぜこの制約か

- sub agent の解釈出力は main に "evidence" として通ってしまい、誤分類が検証されずに次段へ流れる。
- 判断責任を main に集約することで、memory / プロジェクト文脈と結びついた判断精度を担保する。
- 事実 (scripts の JSON) と解釈 (main の判断) を構造的に分離する。

参考: `~/.claude/projects/-Users-tettuan-github-climpt/memory/feedback_subagent_no_interpretation.md` / `feedback_subagent_judgment_boundary.md`

## コスト感

- Haiku (場所特定のみ): script 実行と stdout コピーだけなので軽い。並列しても良い。
- main (Opus): digest JSON (~数 KB) を読むのは context の負担にならない。解釈も main 1 回で完結するので、むしろ全体の turn 数が減る。
- Sonnet: このスキルでは呼ばない。
