# 07. Interfaces — TypeScript Signatures

> **Canonical source**: `tmp/pr-merger-abstraction/abstraction-design.md` §3
> (2026-04-14)。本ドキュメントは infra 層 (orchestrator / dispatcher / runner /
> artifact-emitter) の型を **workflow 宣言駆動の抽象契約** として集約する。
> 採択決定は 00-design-decisions.md § T16 (ArtifactEmitter 抽象化、T15 を
> supersede) を参照。
>
> **位置付け**: 本書 signature は infra に **具象 agent 名 (reviewer / merger /
> iterator / verdict / pr)** を一切含まない。PR Merger 固有の bind は
> `.agent/workflow-merge.json` の `handoffs[]` 宣言で表現し、infra 契約には
> 現れない。

## 1. HandoffDeclaration

位置: `agents/orchestrator/workflow-types.ts` (modified)。

`workflow.json.handoffs[]` の 1 エントリを表す型。infra はこの struct を
**opaque data** として読むのみで、field 値を自身の制御フローで解釈しない。

```typescript
export interface HandoffDeclaration {
  readonly id: string;
  readonly when: {
    readonly fromAgent: string; // agents[] の key (データ値)
    readonly outcome: string; // Canonical Outcome 文字列
  };
  readonly emit: {
    readonly type: string; // artifact 種別タグ
    readonly schemaRef: string; // 例: "pr-merger-verdict@1.0.0"
    readonly path: string; // ${payload.*} 展開可
  };
  readonly payloadFrom: Readonly<Record<string, string>>; // key → JSONPath / literal
  readonly persistPayloadTo: "issueStore" | "none";
}
```

JSONPath 方言・リテラル記法・`${payload.*}` テンプレート規則は `03-data-flow.md`
§1.2 (Handoff Declaration) を参照。

## 2. ArtifactEmitter

位置: `agents/orchestrator/artifact-emitter.ts` (新規作成、旧
`verdict-emitter.ts` の rename)。

02-architecture.md §ArtifactEmitter の具体 signature。dispatch 完了後に
orchestrator が `workflow.handoffs[]` を filter して該当 handoff ごとに `emit()`
を呼ぶ。`sourceAgent` / `sourceOutcome` は識別子文字列で、emitter
実装は値を検査しない (log 用途のみ)。literal union (`"reviewer"|...`) は
型に現れない。

```typescript
// agents/orchestrator/artifact-emitter.ts

export interface ArtifactEmitInput {
  readonly workflowId: string;
  readonly issueNumber: number;
  readonly sourceAgent: string; // data, not a type
  readonly sourceOutcome: string; // data, not enum
  readonly agentResult: Readonly<Record<string, unknown>>;
  readonly handoff: HandoffDeclaration;
}

export interface ArtifactEmitResult {
  readonly payload: Readonly<Record<string, unknown>>;
  readonly artifactPath: string;
}

export interface ArtifactEmitter {
  emit(input: ArtifactEmitInput): Promise<ArtifactEmitResult>;
}
```

### 2.1 `emit()` アルゴリズム (参考)

```
emit(input):
  1. resolveContext = {
       agent:    { id: input.sourceAgent, result: input.agentResult },
       github:   lazy fetch if $.github.pr.* referenced,
       workflow: { id: input.workflowId, agents: workflow.agents,
                   context: { now: clock.now().toISOString() } }
     }
  2. payload = {}
     for (key, expr) of input.handoff.payloadFrom:
        value = resolveJsonPath(expr, resolveContext, { sourceAgent: input.sourceAgent })
        if value === undefined: throw HandoffResolveError({ handoffId, key, expr })
        payload[key] = value
  3. schema = schemaRegistry.get(input.handoff.emit.schemaRef)
     ajvValidate(schema, payload)
  4. artifactPath = renderTemplate(input.handoff.emit.path, { payload })
  5. await writeFile(artifactPath, JSON.stringify(payload, null, 2))
  6. if (input.handoff.persistPayloadTo === "issueStore"):
        await issueStore.writeWorkflowPayload(input.issueNumber, input.workflowId, payload)
  7. return { payload, artifactPath }
```

fail-fast: 任意 step の throw は orchestrator が `handoff-error` outcome に
写像し、issue を blocking phase に遷移させる。

### 2.2 Dependencies (`ArtifactEmitterDeps`)

emitter 実装は以下の dependency を constructor injection で受ける。具象 agent
名には一切依存しない。

```typescript
export interface ArtifactEmitterDeps {
  readonly cwd: string;
  readonly issueStore: IssueStore;
  readonly schemaRegistry: SchemaRegistry;
  readonly githubClient: { prView(prNumber: number): Promise<PrMetadata> };
  readonly clock: { now(): Date };
  readonly writeFile: (path: string, data: string) => Promise<void>;
  readonly workflow: {
    readonly id: string;
    readonly agents: Readonly<
      Record<string, { readonly version: string; readonly dir: string }>
    >;
  };
}
```

## 3. IssuePayload (generic)

位置: `agents/orchestrator/workflow-types.ts` (modified)。

```typescript
export type IssuePayload = Readonly<Record<string, unknown>>;
```

`IssuePayload` は **type alias** であり interface ではない。infra は payload の
key 名を何も知らず、`workflow.json.payloadSchema` (Ajv 検証) によって load /
emit 時に validate する。workflow ごとの具体 shape は agent 側 (`merge-pr.ts`
等) で局所的に再宣言して narrow する。

### 3.1 Trade-off

| 観点             | 固定 interface (旧)    | generic + schema (新)     |
| ---------------- | ---------------------- | ------------------------- |
| コンパイル時型   | strong                 | weak (`unknown`)          |
| 新 workflow 追加 | 型追加必須、infra 変更 | schema 追加のみ           |
| 検証タイミング   | 静的                   | load + emit 時 (Ajv)      |
| IDE 補完         | 有効                   | 無効 (caller narrow 必要) |
| infra 非干渉性   | 低                     | 高                        |

## 4. IssueWorkflowState.payload extension

位置: `agents/orchestrator/workflow-types.ts` (modified)。

```typescript
export interface IssueWorkflowState {
  readonly issueNumber: number;
  currentPhase: string;
  cycleCount: number;
  correlationId: string;
  history: PhaseTransitionRecord[];
  payload?: IssuePayload; // generic Record<string, unknown>
}
```

`payload` は optional。handoff が `persistPayloadTo: "issueStore"` 宣言を
伴う場合のみ ArtifactEmitter が書込、後続 dispatch が読出す。
`workflow-schema.json` 側にも `payload` optional field を追加する。

## 5. DispatchOptions.payload extension

位置: `agents/orchestrator/dispatcher.ts` (modified)。

```typescript
export interface DispatchOptions {
  readonly iterateMax?: number;
  readonly branch?: string;
  readonly issueStorePath?: string;
  readonly getOutboxPath: (issueNumber: number) => string;
  readonly payload?: IssuePayload; // generic Record<string, unknown>
}
```

`dispatcher.ts` は `agent.json.parameters` に宣言された key を payload から
抽出して runnerArgs に展開する。payload に未知 field があっても dispatcher
は無視し、runnerArgs を汚染しない。具体 binding rule は 03-data-flow.md §1.1
を参照。

```typescript
export class RunnerDispatcher {
  async dispatch(
    agentName: string,
    issueNumber: number,
    options?: DispatchOptions,
  ): Promise<DispatchResult> {
    const declared = agentDefinition.parameters; // Record<paramKey, ParamSpec>
    const runnerArgs: Record<string, unknown> = {
      issue: issueNumber,
      iterateMax: options?.iterateMax,
      branch: options?.branch,
      issueStorePath: options?.issueStorePath,
      outboxPath: options?.getOutboxPath(issueNumber),
    };
    for (const key of Object.keys(declared)) {
      const v = options?.payload?.[key];
      if (v !== undefined) runnerArgs[key] = v;
    }
    return await this.runner.run({
      args: runnerArgs,
      issuePayload: options?.payload,
    });
  }
}
```

## 6. AgentRunnerRunOptions.issuePayload extension

位置: `agents/runner/runner.ts` (modified)。

02-architecture.md §Runner context composition の具体 signature。 `issuePayload`
は **optional** かつ型は `Readonly<Record<string, unknown>>`。 特定 workflow の
key 名 (`prNumber` / `verdictPath` 等) は型に現れない。

```typescript
export interface AgentRunnerRunOptions {
  readonly args: Record<string, unknown>;
  readonly issuePayload?: Readonly<Record<string, unknown>>; // NEW
}

export class AgentRunner {
  private issuePayload: Readonly<Record<string, unknown>> | undefined;

  async run(options: AgentRunnerRunOptions): Promise<AgentResult> {
    this.args = options.args;
    this.issuePayload = options.issuePayload;
    // ... 既存処理
  }

  private async runSubprocessClosureIteration(
    /* ... */
  ): Promise<IterationSummary> {
    // BEFORE:  const context = { ...this.args };
    // AFTER:
    const context = {
      ...(this.issuePayload ?? {}),
      ...this.args,
    };
  }
}
```

### 合成ルール

```text
context = { ...(issuePayload ?? {}), ...agentParameters }
```

- **agentParameters 優先** (右側 spread): CLI arg が payload を上書きする (debug
  / manual re-run 時の override)。
- **issuePayload は base**: orchestrator が issueStore から読出した opaque
  payload を context base に据える。

## 7. IssueStore payload API

位置: `agents/orchestrator/issue-store.ts` (modified)。

```typescript
export interface IssueStore {
  // 既存 API は省略 (readWorkflowState / writeWorkflowState 等)

  writeWorkflowPayload(
    issueNumber: number,
    workflowId: string,
    payload: IssuePayload, // = Readonly<Record<string, unknown>>
  ): Promise<void>;

  readWorkflowPayload(
    issueNumber: number,
    workflowId: string,
  ): Promise<IssuePayload | undefined>;
}
```

### 呼出経路

- `writeWorkflowPayload`: `ArtifactEmitter.emit` の step 6 で呼出
  (`persistPayloadTo === "issueStore"` の handoff のみ)。
- `readWorkflowPayload`: orchestrator.ts が後続 dispatch 直前に呼出し、 得た
  payload を `DispatchOptions.payload` に積む。

## 8. SchemaRegistry

位置: `agents/orchestrator/schema-registry.ts` (新規想定、Phase 0
prerequisite)。

```typescript
export interface SchemaRegistry {
  register(ref: string, schema: object): void;
  get(ref: string): object | undefined; // "<name>@<semver>"
}
```

workflow load 時に `workflow.handoffs[*].emit.schemaRef` の未登録参照は 起動時
error とする (fail-fast)。

## 9. 変更責任範囲サマリ

| Interface                                                      | 変更ファイル                                     | §7.1 影響                         |
| -------------------------------------------------------------- | ------------------------------------------------ | --------------------------------- |
| `HandoffDeclaration`                                           | `agents/orchestrator/workflow-types.ts`          | なし (§7.1 非掲載)                |
| `IssuePayload` (type alias)                                    | `agents/orchestrator/workflow-types.ts`          | なし (§7.1 非掲載)                |
| `ArtifactEmitter` / `ArtifactEmitInput` / `ArtifactEmitResult` | `agents/orchestrator/artifact-emitter.ts` (新規) | なし (新規 orchestrator 層)       |
| `DispatchOptions.payload`                                      | `agents/orchestrator/dispatcher.ts`              | なし (§7.1 非掲載)                |
| `AgentRunnerRunOptions.issuePayload`                           | `agents/runner/runner.ts`                        | なし (§7.1 非掲載、optional 拡張) |
| `IssueStore.writeWorkflowPayload` / `readWorkflowPayload`      | `agents/orchestrator/issue-store.ts`             | なし (§7.1 非掲載)                |
| `SchemaRegistry`                                               | `agents/orchestrator/schema-registry.ts` (新規)  | なし (新規)                       |

infra 型のいずれも `"reviewer"` / `"merger"` / `"iterator"` / `"verdict"` /
`"pr"` を literal 型・enum・property name として含まない。PR Merger 固有の bind
はすべて `.agent/workflow-merge.json` の `handoffs[]` 宣言側で表現する。
