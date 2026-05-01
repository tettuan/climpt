# Workflow Recovery Procedures

orchestrator が自律回復できない異常状態から、明示的に最小介入で復帰させる手順集。`agents/CLAUDE.md` の「人間が手動でリカバリーしない」原則の **唯一の例外** として、code fix の前後に永続化された state が新コードと不整合になったケースに限って適用する。

## 適用判定

以下を **すべて** 満たす場合のみ、この文書の手順を実行してよい。

| 条件 | 確認方法 |
|---|---|
| 1. 詰まりの原因が agent コードのバグである | 直近 commit や issue で root cause が特定済み |
| 2. その原因に対する code fix が既にマージ済みである | `git log` で該当 fix を確認 |
| 3. 既存の自律回復 path (label-divergence reset 等) では発火しない | 後述「自律回復 path 一覧」を確認 |
| 4. 影響範囲が単一 issue / 単一 state ファイルに閉じる | 複数 issue 影響時は code-level 解決を優先 |

いずれか 1 つでも欠ける場合、この文書ではなく code-level 修正で対応する。

## 自律回復 path 一覧 (発火条件)

| Path | 発火条件 | 実装 |
|---|---|---|
| Label-divergence reset | persisted `currentPhase` ≠ live label から解決される phase | `orchestrator.ts` `#resolveLivePhaseId` (1202-1246) で検出、`fromState` で `history: [], cycleCount: 0` に置換 (195-199) |
| Phase repetition (L3) | 同一 phase が `maxConsecutivePhases` 連続 | `cycle-tracker.ts` `isPhaseRepetitionExceeded` |
| Cycle limit (L1) | `cycleCount >= maxCycles` | `cycle-tracker.ts` `isExceeded` (停止のみ。回復はしない) |

L1 は **停止判定であって回復機構ではない**。一度 L1 に到達した state は、自律回復 path のいずれにも該当しない限り永久に詰まる。

## R1. Cycle reset (single issue, post-fix migration)

### 状況

`deno task orchestrator` が特定 issue に対して `status: cycle_exceeded` を返し、その原因が **code fix 適用前** の周回で書き込まれた `cycleCount` / `history` である。

### 前提

- `.agent/climpt/tmp/issues-execute/<N>/workflow-state.default.json` の `history` 末尾の timestamp が、関連 fix commit より **古い** こと。
- 該当 issue の live label と persisted `currentPhase` が一致しており、label-divergence reset が発火しないこと。

### 手順

| # | 操作 | 対象 |
|---|---|---|
| 1 | live label を確認 (`meta.json` または `gh issue view <N> --json labels`) | `.agent/climpt/tmp/issues-execute/<N>/meta.json` |
| 2 | persisted state の `history` 末尾 timestamp を確認 | `.agent/climpt/tmp/issues-execute/<N>/workflow-state.default.json` |
| 3 | 関連 fix commit の日時と比較 (state が古いことを確認) | `git log` |
| 4 | state ファイルを下記 schema で上書き | 同上 |
| 5 | `deno task orchestrator --issue <N>` で再実行し、最初の周回が完走することを確認 | — |

### 上書き schema

```json
{
  "subjectId": <N>,
  "currentPhase": "<live label から解決される phase id>",
  "cycleCount": 0,
  "correlationId": "wf-<YYYY-MM-DD>-manual-reset",
  "history": []
}
```

`currentPhase` は `workflow.json` の `labelMapping` を参照し、live label から決定する (例: `need clearance` → `blocked`、`kind:detail` → `detail-pending`)。`correlationId` は `manual-reset` を含めることで、後の log 解析で identification 可能にする。

### 適用例

| 日付 | issue | 起点 fix | 詳細 |
|---|---|---|---|
| 2026-04-26 | #488 | 1a2b51e (`fix(considerer): break workflow ping-pong by trusting current label`) | detailer ↔ clarifier ↔ considerer の ping-pong で 7/7 到達。fix 適用後も persisted state により詰まり継続。`currentPhase: blocked` 維持で reset |

## 禁止事項

- **複数 issue に対する一括 reset を script 化しない。** 一括化が必要になった時点で「単一 issue に閉じる」前提が崩れており、code-level 解決 (`--reset-cycle` フラグ等) が正解。
- **fix commit の確認なしに reset しない。** code 側に未解決の loop 原因がある状態で reset すると、同じ詰まりを再生産するだけになる。
- **`history` を partial に削らない。** 残った transition が新コードの判断基準と矛盾する可能性があるため、必ず `[]` で初期化する。

## 関連

- `.agent/workflow-issue-states.md` — issue 状態遷移定義
- `agents/orchestrator/cycle-tracker.ts` — cycle 計測実装
- `agents/orchestrator/orchestrator.ts` `#resolveLivePhaseId` — label-divergence reset 実装
- `agents/CLAUDE.md` 「禁止事項」 — 手動リカバリー禁止の原則
