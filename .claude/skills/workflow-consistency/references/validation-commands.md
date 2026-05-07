# Validation Commands — exact CLI invocations + error code mapping

SKILL.md §"Validation Commands" の expanded reference。実行コマンド、期待出力、典型 error code への対応を一覧化する。

## 1. Cross-agent (workflow.json) validation

### 1.1 Loader-only quick check

`workflow.json` の schema + cross-reference のみ確認する場合 (per-agent step graph には踏み込まない):

```bash
deno run --allow-read --allow-env \
  --import-map=deno.json \
  - <<'EOF'
import { loadWorkflow } from "./agents/orchestrator/workflow-loader.ts";

try {
  const cfg = await loadWorkflow(Deno.cwd());
  console.log("workflow.json: OK");
  console.log("phases:", Object.keys(cfg.phases));
  console.log("agents:", Object.keys(cfg.agents));
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  Deno.exit(1);
}
EOF
```

`loadWorkflow()` は内部で `validateRequiredFields` (Step 2) → `validateCrossReferences` (Step 3) を順に呼ぶ。失敗時は `ConfigError` を throw し、`code` / `designRule` / `fix` を含むメッセージを stderr に出す。

### 1.2 Full per-agent validate (本 skill が推奨する Step 8)

workflow.json で参照される全 agent について一括で `--validate` を回す:

```bash
# workflow.json の agents キーを列挙
agents=$(jq -r '.agents | keys[]' .agent/workflow.json)

for a in $agents; do
  echo "=== $a ==="
  deno task agent --validate --agent "$a"
done
```

各 agent の validate は以下を含む (`agents/scripts/run-agent.ts:168-507`):

| Internal check | source | catches |
|----------------|--------|---------|
| `agent.json` Schema | `agents/config/mod.ts` | AC-* errors |
| `agent.json` Configuration | 同上 | verdict.type 不整合 |
| `steps_registry.json` Schema | 同上 | SR-* errors |
| Cross-references (per-agent) | 同上 | step / schema 解決失敗 |
| Paths | 同上 | C3L prompt / schema 不在 |
| Labels | `agents/orchestrator/workflow-loader.ts` | workflow.json で宣言した label が repo に無い |
| Flow | `agents/config/flow-validator.ts` | per-agent step graph (reachability / SCC / boundary) |
| Prompts | runner | step ごとの prompt 設定 |
| UV Reachability | runner | UV 変数 supply source 不在 |
| Template UV | runner | placeholder と宣言の整合 |
| Step Registry | runner | step ADT 整合 |
| Handoff Inputs | runner | step A の handoff field と step B の input |
| Config Registry | runner | `.agent/climpt/config/*.yml` と registry pattern |

### 1.3 Sandbox 注意

Claude Code の Bash tool から `deno task agent` を呼ぶ場合は二重 sandbox に注意する (`agents/CLAUDE.md` §"Claude Code 内からの実行"):

```typescript
Bash({
  command: "deno task agent --validate --agent iterator",
  dangerouslyDisableSandbox: true,
});
```

ターミナルから直接実行する場合は不要。

## 2. Error Code Mapping

`agents/shared/errors/config-errors.ts` の WF-* prefix を本 skill の rule にマップする。各 error は `[CODE] What\nDesign: <rule>\nFix: <action>` の 3-line format で stderr に出る。

| Code | 関数 | 本 skill での該当 rule | 典型例 |
|------|------|------------------------|--------|
| `WF-LOAD-001` | `wfLoadNotFound` | (前提) | `.agent/workflow.json` 不在 |
| `WF-LOAD-002` | `wfLoadReadFailed` | (前提) | 読み取り権限 / I/O 失敗 |
| `WF-LOAD-003` | `wfLoadInvalidJson` | (前提) | JSON parse 失敗 |
| `WF-SCHEMA-001` | `wfSchemaVersionRequired` | R2 の前提 | `version` field 欠落 |
| `WF-SCHEMA-002` | `wfSchemaPhasesRequired` | R3 の前提 | `phases` field 欠落 |
| `WF-SCHEMA-003` | `wfSchemaLabelMappingRequired` | R4 の前提 | `labelMapping` field 欠落 |
| `WF-SCHEMA-004` | `wfSchemaAgentsRequired` | R1 / R2 の前提 | `agents` field 欠落 |
| `WF-PHASE-001` | `wfPhaseInvalidType` | R3 | `type` が `actionable/terminal/blocking` 以外 |
| `WF-PHASE-002` | `wfPhaseAgentRequired` | R8 の前提 | actionable phase に `agent` 未指定 |
| `WF-PHASE-003` | `wfPhasePriorityRequired` | (`07_flow_design.md` §"設計の手順") | actionable phase に `priority` 未指定 |
| `WF-LABEL-001` | `wfLabelMappingEmpty` | R4 | `labelMapping` が空 |
| `WF-LABEL-002` | `wfLabelUnknownPhase` | R4 | label が unknown phase を指す |
| `WF-LABEL-003` | `wfLabelSpecMissing` | (補助) | `labels` 宣言と `labelMapping` の差 |
| `WF-LABEL-004` | `wfLabelSpecOrphan` | R4 | `labels` 宣言が `labelMapping` / `prioritizer.labels` で未参照 (routing role) |
| `WF-LABEL-005` | `wfLabelSpecInvalidColor` | (補助) | hex 形式違反 |
| `WF-RULE-001` | `wfRuleMaxCyclesInvalid` | R6 | `maxCycles ≤ 0` |
| `WF-RULE-002` | `wfRuleCycleDelayInvalid` | (補助) | `cycleDelayMs < 0` |
| `WF-REF-001` | `wfRefUnknownAgent` | R1 / R4 | `phases[X].agent` が agents に無い |
| `WF-REF-002` | `wfRefUnknownFallbackPhase` | R8 | agent の `fallbackPhase` が phases に無い |
| `WF-REF-003` | `wfRefUnknownOutputPhase` | R3 / R4 | transformer の `outputPhase` が phases に無い |
| `WF-REF-004` | `wfRefUnknownOutputPhasesEntry` | R3 / R4 | validator `outputPhases.X` が phases に無い |
| `WF-REF-005` | `wfRefCloseConditionWithoutCloseOnComplete` | R7 | `closeBinding.condition` 単独宣言 (primary が `none`) |
| `WF-REF-006` | `wfRefInvalidCloseCondition` | R7 | `closeBinding.condition` が `outputPhases` の key 集合に無い |
| `WF-PROJECT-001..010` | `wfProject*` | (project binding 検証) | sentinel / done / eval / plan phase 不整合 |
| `WF-ISSUE-SOURCE-001..` | `wfIssueSource*` | (entry 前提) | `issueSource.kind` 未対応値 / 必須 field 欠落 |

## 3. 本 skill 独自診断 (R5 / R9) の reporting format

`flow-validator.ts` / `workflow-loader.ts` では検出されない rule は手診断する。検出した場合は WF-* と同じ 3-line format で並べる:

```
[skill:WF-CONSISTENCY-R5] Bypass return-flow detected: agent "detailer" lacks state mutation in leg "detail-pending → impl-pending".
Design: agents/docs/design/realistic/16-flow-completion-loops.md §C, .agent/workflow-issue-states.md §"S2.running の kind 分岐"
Fix: Add comment template "detailerHandoffImpl" to workflow.json#handoff.commentTemplates, or declare handoffFields with comment_body in detailer's closure step.
```

```
[skill:WF-CONSISTENCY-R9] Unbounded self-cycle detected: agent "iterator" outputPhase "impl-pending" is the same phase iterator handles.
Design: agents/docs/builder/07_flow_design.md §3.2 (Retry Loop must use fallbackPhase, not outputPhase)
Fix: Move impl-pending self-reference to iterator.fallbackPhase, or insert a recovery agent (per §3.5).
```

`[skill:WF-CONSISTENCY-*]` prefix は **本 skill の手診断結果** であることを明示する。CI で grep する場合は WF-* と区別できる。

## 4. JSON Schema 単独 validate (optional)

CI で workflow.json を単独 schema validate したい場合 (loader を経由せず):

```bash
deno run --allow-read --allow-net \
  https://deno.land/x/ajv@v8.12.0/ajv.ts \
  validate \
  -s agents/orchestrator/workflow-schema.json \
  -d .agent/workflow.json
```

ただし schema validation だけでは cross-reference (`WF-REF-*`) と本 skill の R5 / R9 は捕まえられないので、最終 gate には 1.2 (per-agent --validate 一括) を使う。
