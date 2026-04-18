# PR Merger Design

> **Status**: Design complete (T16, 2026-04-14). **Implementation pending —
> Phase 0 prerequisites are blockers (including new Phase 0-e:
> schemaRegistry).**

## ⚠ Phase 0 Prerequisites (実装着手前に必須)

PR Merger の実装は、以下 4 つの Phase 0 prerequisite が climpt
本体で先行実装されていることを前提とする。これらが未実装のまま PR Merger
実装に着手すると、closure step の subprocess spawn が成立しない。

1. **Phase 0-a**: `dispatcher.ts` で `issue.payload` → agent `parameters` への
   generic binding 機構 (`agent.json.parameters` declared key のみ展開)
2. **Phase 0-b**: `AgentRunner` における `${context.*}` template substitution
3. **Phase 0-c**: closure step の subprocess runner kind (現状 prompt-only
   closure のみ)
4. **Phase 0-d**: boundary hook での事象再発火機構 (optional; audit 目的)
5. **Phase 0-e**: `agents/orchestrator/schema-registry.ts` 新設
   (`<name>@<semver>` 形式の artifact schema lookup、T16 で追加)

詳細は `05-implementation-plan.md § 1.2.1` 依存ファイル表と `§ 5 Rollout` Phase
0 行を参照。

## Read order

1. `00-design-decisions.md` — Amendment chain (T8 → T10 → T12 → T14 → T15 → T16
   最新)
2. `01-overview.md` — 設計概要
3. `02-architecture.md` — コンポーネント責務 + LLM 境界 + ArtifactEmitter
   (workflow-driven artifact emission)
4. `03-data-flow.md` — canMerge pure function + Reason↔Outcome + Handoff
   Declaration (workflow.json)
5. `04-state-machine.md` — phase 遷移 + handoff contract
6. `05-implementation-plan.md` — 依存ファイル + rollout phases (Phase 0-e
   schemaRegistry を含む)
7. `06-workflow-examples.md` — workflow-merge.json + agent.json 実例
8. `07-interfaces.md` — Generic infra TypeScript signatures (HandoffDeclaration
   / ArtifactEmitter / IssuePayload = Record<string, unknown> /
   DispatchOptions.payload / AgentRunnerRunOptions.issuePayload / IssueStore /
   SchemaRegistry)。00-design-decisions.md § T16 の implementation source of
   truth。infra 型に specific agent 名 (reviewer/merger/verdict/pr) は含まない。

## Decision record

| ADR | Scope                                                 | Status                |
| --- | ----------------------------------------------------- | --------------------- |
| T8  | Canonical outcome names (5 values)                    | Active (継承)         |
| T10 | Scheduler unification (orchestrator only, cron 廃止)  | Active (継承)         |
| T12 | canMerge / mergePr responsibility split               | Active (継承)         |
| T14 | Runner-mediated flow (4-layer subprocess)             | Active (継承)         |
| T15 | VerdictEmitter (orchestrator-side verdict 導出)       | **Superseded by T16** |
| T16 | ArtifactEmitter 抽象化 (workflow.handoffs[] 宣言駆動) | **Active (最新)**     |

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
