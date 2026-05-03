---
name: logs-analysis
description: Use when investigating tmp/logs contents — orchestrator session JSONL, per-agent JSONL, or examples stdout/stderr. Uses deterministic TS digest scripts. Haiku sub agent is used ONLY for file location (index-logs.ts) and element-filtered line search (search-logs.ts); all interpretation stays in main. Trigger phrases — "tmp/logs を調べる", "session log を見て", "なぜ orchestrator が止まった", "agent のイテレーション", "examples の失敗ログ", "analyze logs", "ログ調査".
allowed-tools: [Read, Glob, Grep, Bash, Task]
---

# Logs Analysis

`tmp/logs/` 配下の実行ログを **deterministic TS スクリプトで digest 化 → main (Opus) が解釈** するスキル。
sub agent (Haiku/Sonnet) には **解釈を任せない**。場所特定のみ Haiku にオフロードでき、それ以外 (分類・RCA・verdict) は main が行う。

## 責任分担 (最重要)

| 役割 | 担当 | 範囲 |
|------|------|------|
| 場所特定 (どのファイルを見るか) | **Haiku sub agent (optional)** | `index-logs.ts` の実行と path の返却のみ。解釈・判断・要約はしない |
| 行特定 (要素絞り込み: event/level/agent/query/since 等で hit を絞る) | **Haiku sub agent (optional)** | `search-logs.ts` の実行と `{file, line, snippet}` の返却のみ。snippet を要約・解釈しない |
| digest 生成 (scripts の実行) | **main (Opus)** | `summarize-*.ts`, `extract-errors.ts` を Bash で直接実行 |
| 該当行の本文読取 | **main (Opus)** | search-logs hit の `file:line` を Read tool で開いて生ログを確認 |
| 解釈 (分類 / success/fail 判定 / RCA / 次アクション) | **main (Opus)** | digest JSON / 生行を読んで判断 |
| Sonnet / その他 sub agent | **使わない** | 解釈を sub agent に委譲しない |

**禁止事項**:

- Haiku/Sonnet に digest JSON を渡して「分類して」「verdict を返して」と頼まない
- sub agent に「原因を推測して」「RCA を書いて」と頼まない
- Haiku に渡してよい script は **`index-logs.ts` と `search-logs.ts` のみ** (場所/行の特定で副作用なし)。`summarize-*.ts` / `extract-errors.ts` は main が直接 Bash する

## 構造定義 (`tmp/logs/` スキーマ)

| Path | 1 ファイル = | 1 行 = | 備考 |
|------|-------------|--------|------|
| `orchestrator/session-<ISO>.jsonl` | 1 orchestrator run | `{step, timestamp, level, message, metadata}` | `metadata.event` で分類。`run_start` → `run_end` で run が閉じる |
| `agents/<agent>/<agent>-<ISO>.jsonl` | 1 agent runner 起動 | `{timestamp, level, message, metadata?}` | `step` 無し。prefix (`[FlowLoop]`, `[CompletionLoop]`, `[ClosureAdaptation]` 等) で分類 |
| `examples/<ISO>/NN_*.log` | examples step 1 つの stdout/stderr | 自由形式テキスト | 連番 `NN_*` で step 順 |
| `launchd-triager.{err,out}` | launchd 起動 triager の stdout/stderr | 自由形式 | rotate なし、追記のみ |
| `orchestrator-<issue>-<ts>.log` | legacy orchestrator log | 自由形式 | deprecated (新規は session-*.jsonl へ) |

### orchestrator `metadata.event` (主な値)

`batch_start`, `lock_acquired`, `sync_complete`, `queue_built`, `run_start`, `labels`, `phase_resolved`, `dispatch`, `dispatch_result`, `transition`, `issue_closed`, `issue_error`, `run_end`, `batch_end`, `label_sync_skipped`, `label_sync_baseline_failed`

### agent jsonl の message prefix (主な値)

`[FlowLoop] Enter`, `[FlowLoop] Exit`, `[CompletionLoop] Iteration enter`, `[CompletionLoop] Validation result`, `[ClosureAdaptation] Resolved closure prompt for step`, `Prompt resolved: ...`, `SDK message: ...`, `SDK result`, `Assistant response`, `Maximum iterations (N) reached without finishing`

## 参照方法 (workflow)

### Step 1. Where — ファイル場所特定 (Haiku optional)

**Haiku sub agent に委譲可 (mechanical only)**。main が直接 Bash しても良い。

```bash
deno run -A .claude/skills/logs-analysis/scripts/index-logs.ts
deno run -A .claude/skills/logs-analysis/scripts/index-logs.ts --category orchestrator --limit 5
```

Haiku に渡すときの prompt 例 (解釈要求を含めない):

```typescript
Task({
  subagent_type: "general-purpose",
  model: "haiku",
  description: "List recent log files",
  prompt: `次のコマンドを実行し、stdout の JSON をそのまま返してください。解釈・要約・分類はしないでください。\n\n` +
          `cd /Users/tettuan/github/climpt && deno run -A .claude/skills/logs-analysis/scripts/index-logs.ts --category orchestrator --limit 5`,
});
```

返値は JSON そのまま。main がパースして、どのファイルを見るか決める。

### Step 2. Locate — 行特定 (Haiku optional, search by elements)

要素 (event / level / agent / step / regex / time window) で hit を絞り、`{file, line, snippet}` を得る。**TS が検索を実行**し、Haiku は実行と JSON 返却のみ担当。Haiku は snippet を読み解かない。

```bash
# 要素絞り込み (filters は AND 結合)
deno run -A .claude/skills/logs-analysis/scripts/search-logs.ts --category orchestrator --event dispatch_result --level error --max 30
deno run -A .claude/skills/logs-analysis/scripts/search-logs.ts --agent reviewer --query "Maximum iterations" --since 2026-04-20
deno run -A .claude/skills/logs-analysis/scripts/search-logs.ts --file tmp/logs/orchestrator/session-<ISO>.jsonl --event run_end
deno run -A .claude/skills/logs-analysis/scripts/search-logs.ts --category examples --query "ERROR|failed"   # examples は --query 必須
```

主な flag (詳細は `search-logs.ts` の usage コメント):

| Flag | 効果 |
|------|------|
| `--category` | `orchestrator\|agents\|examples\|all` (default: all) |
| `--agent` | `agents/<name>/*` のみ走査 (category=agents 自動) |
| `--file` | 単一ファイルに絞る (Step 1 で得た path をそのまま渡す) |
| `--query` | message / 行に対する正規表現 (case-insensitive)。examples では必須 |
| `--event` | `metadata.event` 等価一致 (JSONL のみ) |
| `--level` | `info\|warn\|error\|debug` 等価一致 (JSONL のみ) |
| `--since` / `--until` | ISO timestamp 範囲 (JSONL のみ) |
| `--step` | orchestrator step 等価一致 |
| `--max` | hit 上限 (default 100。`truncated:true` で打ち切り検知) |

Haiku に渡すときの prompt 例:

```typescript
Task({
  subagent_type: "general-purpose",
  model: "haiku",
  description: "Search recent log lines by element",
  prompt: `次のコマンドを実行し、stdout の JSON をそのまま返してください。\n` +
          `snippet の内容を要約・解釈・分類しないでください。出力をそのまま貼り付けるだけです。\n\n` +
          `cd /Users/tettuan/github/climpt && deno run -A .claude/skills/logs-analysis/scripts/search-logs.ts --category orchestrator --event dispatch_result --level error --max 30`,
});
```

返値の `hits[].file` と `hits[].line` を main が受け取り、Read tool で `offset=line` 周辺を直接読む。snippet は「どの hit を読むか」の選別用に main が見る (要約済み参照ではない)。

### Step 3. Read — main (Opus) が該当行の本文を読む

search-logs の hit を起点に Read tool で開く:

- `Read({ file_path: hits[i].file, offset: hits[i].line - 5, limit: 30 })` のように前後文脈ごと開く
- 隣接 hit が同一ファイルなら 1 回の Read で複数 hit をカバーできるよう offset/limit を main が設計する
- `truncated: true` の場合は `--max` を増やす / filter を絞り直して Step 2 を再実行

### Step 4. Digest — 集計 (main が直接実行)

```bash
# orchestrator session → event counts / transitions / errors / dispatch outcomes
deno run -A .claude/skills/logs-analysis/scripts/summarize-orchestrator.ts tmp/logs/orchestrator/session-<ISO>.jsonl

# agent jsonl → iterations / level counts / closure adaptations / errors
deno run -A .claude/skills/logs-analysis/scripts/summarize-agent.ts tmp/logs/agents/<agent>/<agent>-<ISO>.jsonl

# 全カテゴリ横断 error 抽出 (level=error + 既知 error event)
deno run -A .claude/skills/logs-analysis/scripts/extract-errors.ts --since 2026-04-20 --max 50
```

これらは **main (Opus) が Bash で直接実行する**。sub agent 経由にしない — 解釈が紛れ込む risk を避けるため。

### Step 5. Interpret — main (Opus) が解釈

digest JSON / 該当行の本文を main が読んで判断する:

- 成功 / 失敗 / 途中終了の判定
- `dispatchOutcomes` や `maxIterationHits` から挙動の異常を読む
- 複数 digest を main 自身で並べて相関を見る
- ユーザーへの回答 / 次アクションを main が決める

sub agent (Haiku/Sonnet) は呼ばない。解釈は main の責任。

詳細: `references/model-selection.md`

## 典型シナリオ

### 「最新の orchestrator run を調べて」

```
1. main → Haiku に index-logs.ts --category orchestrator --limit 1 を実行させる (場所特定)
2. main → 返ってきた path に対して summarize-orchestrator.ts を Bash で直接実行
3. main → digest を読んで成功 / 失敗 / 異常を判断 → user へ報告
```

### 「特定の event / level の発生箇所だけ見たい」(要素絞り込み)

```
1. main → Haiku に search-logs.ts --event dispatch_result --level error --max 30 を実行させる (行特定のみ)
2. main → 返ってきた hits[] の {file, line} ごとに Read で前後文脈を main が直接開く
3. main → 該当行と周辺メタデータから判断 → 必要なら Step 4 (digest) で全体集計に進む
```

### 「agent が止まった原因を知りたい」

```
1. main → Haiku に index-logs.ts --category agents --limit 3 を実行させる
2. main → 該当 agent jsonl に summarize-agent.ts を Bash で直接実行
3. main → 同時刻帯の orchestrator session も summarize-orchestrator.ts で digest 化
4. main → Haiku に search-logs.ts --agent <name> --query "Maximum iterations|Agent failed" --since <ts> を実行させ、停止前後の行を file:line で受け取る
5. main → Read で該当行を開き、digest と突き合わせて RCA を main が書く (sub agent に書かせない)
```

### 「直近で何か error が出ているか」

```
1. main → Bash で extract-errors.ts --since <date> --max 30 を直接実行
2. main → hits[] を読んで、既知 pattern (TLS / rate limit / timeout) に main が mapping
3. main → 未知 pattern のみ user に提示
```

## 注意事項

- **scripts は read-only / 副作用なし**。ファイル削除や rotation は範囲外。
- `examples/` は 119MB 超。raw を LLM に流さない。必ず script で digest 化する。
- `launchd-triager.{err,out}` と legacy `orchestrator-*.log` は自由形式なので、script 対象外。main が手動 `grep`/`tail` で対応。
- `tmp/logs/CLAUDE.md` は index pointer として残す (本 SKILL.md が詳細版)。
