# Facilitator Agent

An autonomous facilitator agent focused on project state analysis and enabling
next actions for other agents.

## Overview

The facilitator agent is designed around the concept of "場の制御" (field
control) - maintaining the project in an actionable state so other agents can
proceed with their work.

## 場の制御 (Field Control) - Definition

### 前提 (Premise)

Iterator や Reviewer が作業した後、あるいは何をしたか不明な状態である。

### 疑問 (Questions to Resolve)

- Project 内の残 issue は実施が必要なのか？
- 次に何をすべきか？
- Issue は作業後に追加されたのか？作業前からあるものが残ったのか？
- どこまで進んだのか？

### 確認すること (Analysis)

作業ログ、commit、残 issue を並べて時系列に分析する:

1. **作業ログ確認** - Agent のセッションログから実行履歴を把握
2. **Commit 履歴** - 実際に行われた変更を確認
3. **残 Issue 分析** - Project 内の未完了 issue の状態を確認
4. **Issue コメント** - 疑問が残れば issue のコメントを確認

### 判断 (Decision)

| 状況           | 対応                                                   |
| -------------- | ------------------------------------------------------ |
| 作業継続が必要 | Issue にコメントし作業を促す、完了条件を Update        |
| 作業不要       | Close が必要か判断が必要である旨、コメントを残す       |
| ブロッカーあり | ブロッカーを明示し、解消方法を提案                     |
| 状態不明       | 追加調査が必要な項目を明記                             |

**重要**: 着手可能な状態を維持することが目的。

### 完了時 (Completion)

他の Agent に何をさせるべきかを返す:

```json
{
  "recommendation": {
    "nextAgent": "iterator | reviewer | none",
    "targetIssues": [123, 456],
    "reason": "Why this action is recommended"
  }
}
```

### 狙い (Goal)

Project / Issue の状態が、実装状況と照らして手を打つべきなのか判断する:

- Iterator を呼ぶべきか？（実装作業が必要）
- Reviewer を呼ぶべきか？（レビュー待ちがある）
- 何もしなくてよいか？（全て完了、または判断待ち）

## Workflow

```
[Iterator/Reviewer 作業後]
         │
         ▼
    ┌─────────────────┐
    │  状態分析       │  ← 作業ログ、commit、残issue
    └────────┬────────┘
             │
             ▼
    ┌─────────────────┐
    │  疑問解消       │  ← Issue コメント確認
    └────────┬────────┘
             │
             ▼
    ┌─────────────────┐
    │  判断・対応     │  ← コメント追加、状態更新
    └────────┬────────┘
             │
             ▼
    ┌─────────────────┐
    │  推奨アクション │  ← 次に呼ぶべき Agent を返す
    └─────────────────┘
```

## Usage

```bash
# Basic project facilitation
deno task agents:run facilitator --project 5

# With label filter
deno task agents:run facilitator --project 5 --label "sprint-1"

# With owner specification
deno task agents:run facilitator --project 5 --project-owner "username"
```

## Outputs

### Health Score

プロジェクト健全性スコア (0-100):

- Blocked issue: -15 点/件
- Stale issue (7 日以上更新なし): -10 点/件
- 完了率ボーナス: 最大 +20 点

### facilitate-action

- `status` - プロジェクト状態レポート
- `attention` - 注意が必要な issue を通知
- `blocker` - ブロッカーを報告
- `suggest` - 優先度を提案
- `stale` - Stale アイテムをマーク

### status-report

- `check` - 状態チェック結果
- `daily` - 日次状態レポート
- `cycle-complete` - 確認サイクル完了

### recommendation

```json
{
  "nextAgent": "iterator",
  "targetIssues": [123],
  "reason": "Issue #123 has pending implementation work"
}
```

## Configuration

See `agent.json` for full configuration options including:

- `checkInterval` - How often to check status (minutes)
- `iterateMax` - Maximum facilitation iterations
- Label configurations for automated tagging

## Prompt Structure

```
prompts/
├── system.md                           # Agent system prompt
└── steps/
    ├── initial/
    │   ├── statuscheck/f_default.md   # Initial status check
    │   ├── blockercheck/f_default.md  # Blocker analysis
    │   ├── stalecheck/f_default.md    # Stale item detection
    │   ├── report/f_default.md        # Report generation
    │   └── facilitate/f_default.md    # Facilitation action
    └── continuation/
        ├── statuscheck/f_default.md   # Ongoing monitoring
        └── complete/f_default.md      # Cycle completion
```
