# PR Merger Design

> **Status**: Design complete (T14, 2026-04-13). **Implementation pending —
> Phase 0 prerequisites are blockers.**

## ⚠ Phase 0 Prerequisites (実装着手前に必須)

PR Merger の実装は、以下 4 つの Phase 0 prerequisite が climpt
本体で先行実装されていることを前提とする。これらが未実装のまま PR Merger
実装に着手すると、closure step の subprocess spawn が成立しない。

1. **Phase 0-a**: `dispatcher.ts` で `issue.payload` → agent `parameters` への
   binding 機構
2. **Phase 0-b**: `AgentRunner` における `${context.*}` template substitution
3. **Phase 0-c**: closure step の subprocess runner kind (現状 prompt-only
   closure のみ)
4. **Phase 0-d**: boundary hook での事象再発火機構 (optional; audit 目的)

詳細は `05-implementation-plan.md § 1.2.1` 依存ファイル表と `§ 5 Rollout` Phase
0 行を参照。

## Read order

1. `00-design-decisions.md` — Amendment chain (T8 → T10 → T12 → T14)
2. `01-overview.md` — 設計概要
3. `02-architecture.md` — コンポーネント責務 + LLM 境界
4. `03-data-flow.md` — canMerge pure function + Reason↔Outcome
5. `04-state-machine.md` — phase 遷移 + handoff contract
6. `05-implementation-plan.md` — 依存ファイル + rollout phases
7. `06-workflow-examples.md` — workflow-merge.json + agent.json 実例

## Core design principles

- **LLM/Deterministic 境界の厳守**: reviewer agent (LLM) の出力は verdict JSON
  を経由して merger-cli (deterministic) に渡る。merger-cli は LLM 不介在。
- **既存 workflow-impl への非干渉**: iterator/reviewer agent の
  prompt・steps_registry.json は変更しない。
- **Runner-mediated flow (T14)**: workflow-merge orchestrator →
  `agents/scripts/run-agent.ts` → `AgentRunner` closure step →
  `agents/scripts/merge-pr.ts` の 4 層構造。BOUNDARY_BASH_PATTERNS の nested
  subprocess escape を活用。
- **canMerge は純関数 (T12)**:
  `(prData, verdict) => { outcome, reason, gate }`。I/O は mergePr wrapper
  が担う。

## Related documents

- `../claude-agent-sdk.md` — Agent SDK の sandbox 境界
- `../orchestrator-design-rationale.md` — workflow-impl orchestrator 設計
- `../worktree-design.md` — F10 finalizeWorktreeBranch パターン (parent-process
  免除の先行例)
