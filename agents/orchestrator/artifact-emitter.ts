/**
 * Artifact Emitter — declarative handoff payload resolver and writer.
 *
 * After each dispatch completes, the orchestrator filters
 * `workflow.handoffs[]` by source agent id and outcome string, then calls
 * {@link ArtifactEmitter.emit} once per matching declaration. The emitter
 * resolves JSONPath / literal expressions in `handoff.payloadFrom` against
 * a composed context, validates the assembled payload against the registered
 * schema, renders the artifact path template, writes the JSON artifact, and
 * optionally persists the payload to the issue store.
 *
 * The emitter is intentionally agent-agnostic: it never inspects
 * `sourceAgent` / `sourceOutcome` as a typed enum and never short-circuits on
 * any specific workflow semantics. All binding is expressed in the handoff
 * declaration and resolved opaquely here.
 */

import { dirname } from "@std/path";
import type { HandoffDeclaration, IssuePayload } from "./workflow-types.ts";
import type { SchemaRegistry } from "./schema-registry.ts";
import type { IssueStore } from "./issue-store.ts";

// =============================================================================
// Public contract
// =============================================================================

/** Input to a single handoff emission. */
export interface ArtifactEmitInput {
  readonly workflowId: string;
  readonly issueNumber: number;
  /** Source agent id as declared in workflow.agents — data, not a type. */
  readonly sourceAgent: string;
  /** Canonical outcome string produced by the source agent — data, not enum. */
  readonly sourceOutcome: string;
  /** Structured output produced by the source agent. */
  readonly agentResult: Readonly<Record<string, unknown>>;
  /** The matched handoff declaration to emit. */
  readonly handoff: HandoffDeclaration;
}

/** Result of a successful emission. */
export interface ArtifactEmitResult {
  readonly payload: IssuePayload;
  readonly artifactPath: string;
}

/** Minimal PR metadata shape needed for `$.github.pr.*` resolution. */
export interface PrMetadata {
  readonly number: number;
  readonly baseRefName: string;
}

/** Lazy GitHub accessor. Emitter never calls this unless `$.github.pr.*` is referenced. */
export interface GithubClient {
  prView(prNumber: number): Promise<PrMetadata>;
}

/**
 * Per-agent workflow metadata resolved from `workflow.agents` at load time.
 * Only fields actually referenced from `$.workflow.agents[<id>].*` need to be
 * present; missing fields yield `HandoffResolveError` at emit time.
 */
export interface WorkflowAgentInfo {
  readonly id: string;
  readonly version?: string;
  readonly dir?: string;
}

/** Constructor-injected dependencies for the default emitter. */
export interface ArtifactEmitterDeps {
  readonly schemaRegistry: SchemaRegistry;
  readonly issueStore: Pick<IssueStore, "writeWorkflowPayload">;
  readonly githubClient: GithubClient;
  readonly clock: { now(): Date };
  readonly writeFile: (path: string, data: string) => Promise<void>;
  readonly workflowAgents: Readonly<Record<string, WorkflowAgentInfo>>;
  readonly logger?: {
    info: (obj: unknown, msg?: string) => void;
    error: (obj: unknown, msg?: string) => void;
  };
}

/** Emitter abstract interface. */
export interface ArtifactEmitter {
  emit(input: ArtifactEmitInput): Promise<ArtifactEmitResult>;
}

// =============================================================================
// Errors
// =============================================================================

/**
 * Thrown when a `payloadFrom` expression cannot be resolved against the
 * emission context. Carries enough data for orchestrator diagnostics.
 */
export class HandoffResolveError extends Error {
  constructor(
    public readonly handoffId: string,
    public readonly key: string,
    public readonly expr: string,
    cause?: string,
  ) {
    super(
      cause
        ? `Handoff ${handoffId}: cannot resolve ${key} from ${expr} (${cause})`
        : `Handoff ${handoffId}: cannot resolve ${key} from ${expr}`,
    );
    this.name = "HandoffResolveError";
  }
}

/** Thrown when the resolved payload fails schema validation. */
export class HandoffSchemaValidationError extends Error {
  constructor(
    public readonly handoffId: string,
    public readonly schemaRef: string,
    public readonly validationErrors: ReadonlyArray<string>,
  ) {
    super(
      `Handoff ${handoffId}: payload failed ${schemaRef}: ${
        validationErrors.join("; ")
      }`,
    );
    this.name = "HandoffSchemaValidationError";
  }
}

// =============================================================================
// Default implementation
// =============================================================================

/**
 * Regular expression identifying references to `$.github.pr.*` anywhere in
 * a `payloadFrom` expression. Used for the pre-scan that decides whether
 * the lazy GitHub fetch must fire.
 */
const GITHUB_PR_REF_RE = /\$\.github\.pr\./;

/**
 * JSONPath root dialect recognized by the emitter. Each root has a
 * dedicated resolver; no general-purpose JSONPath engine is pulled in.
 */
type Root = "agent" | "github" | "workflow";

interface ResolveContext {
  readonly agent: {
    readonly id: string;
    readonly result: Readonly<Record<string, unknown>>;
  };
  readonly github: { readonly pr?: PrMetadata };
  readonly workflow: {
    readonly id: string;
    readonly agents: Readonly<Record<string, WorkflowAgentInfo>>;
    readonly context: { readonly now: string };
  };
}

/**
 * Default in-process emitter. Behaviour matches
 * `tmp/pr-merger-abstraction/abstraction-design.md` §3.2.
 */
export class DefaultArtifactEmitter implements ArtifactEmitter {
  readonly #deps: ArtifactEmitterDeps;

  constructor(deps: ArtifactEmitterDeps) {
    this.#deps = deps;
  }

  async emit(input: ArtifactEmitInput): Promise<ArtifactEmitResult> {
    const { handoff } = input;

    // Step 1: pre-scan — fetch PR metadata only if any expression actually
    // references `$.github.pr.*`. The `prView` call is skipped entirely
    // otherwise, keeping emissions that don't need GitHub data offline-safe.
    //
    // PR number source: when a handoff needs PR metadata it inherits the
    // PR number from `input.issueNumber`. This matches workflows where the
    // GitHub issue number and PR number coincide (e.g. PR-based workflows
    // such as `.agent/workflow-merge.json`). Handoffs for non-PR workflows
    // simply do not reference `$.github.pr.*` and never trigger this fetch.
    const needsGithubPr = Object.values(handoff.payloadFrom).some((expr) =>
      GITHUB_PR_REF_RE.test(expr)
    );
    const prMetadata: PrMetadata | undefined = needsGithubPr
      ? await this.#deps.githubClient.prView(input.issueNumber)
      : undefined;

    const ctx: ResolveContext = {
      agent: { id: input.sourceAgent, result: input.agentResult },
      github: { pr: prMetadata },
      workflow: {
        id: input.workflowId,
        agents: this.#deps.workflowAgents,
        context: { now: this.#deps.clock.now().toISOString() },
      },
    };

    // Step 2: resolve all payloadFrom entries. Path-template expansion is
    // intentionally deferred to a second pass so entries may reference
    // each other via `${payload.<key>}` regardless of iteration order.
    const rawPayload: Record<string, unknown> = {};
    const templateEntries: Array<[string, string]> = [];

    for (const [key, expr] of Object.entries(handoff.payloadFrom)) {
      if (containsPayloadTemplate(expr)) {
        templateEntries.push([key, expr]);
        continue;
      }
      rawPayload[key] = this.#resolveExpression(expr, ctx, handoff.id, key);
    }

    for (const [key, expr] of templateEntries) {
      rawPayload[key] = renderPayloadTemplate(
        expr,
        rawPayload,
        handoff.id,
        key,
      );
    }

    const payload: IssuePayload = Object.freeze({ ...rawPayload });

    // Step 3: schema validation — fail-fast, throw on unregistered ref too.
    const outcome = this.#deps.schemaRegistry.validate(
      handoff.emit.schemaRef,
      payload,
    );
    if (!outcome.valid) {
      throw new HandoffSchemaValidationError(
        handoff.id,
        handoff.emit.schemaRef,
        outcome.errors,
      );
    }

    // Step 4: render artifact path template.
    const artifactPath = renderPayloadTemplate(
      handoff.emit.path,
      rawPayload,
      handoff.id,
      "<emit.path>",
    );

    // Step 5: write artifact. Ensure the parent directory exists — artifact
    // paths like `tmp/climpt/orchestrator/emits/<pr>.json` may resolve to a
    // directory that does not yet exist on a fresh workspace.
    const artifactDir = dirname(artifactPath);
    await Deno.mkdir(artifactDir, { recursive: true });
    await this.#deps.writeFile(artifactPath, JSON.stringify(payload, null, 2));

    // Step 6: optional issue-store persistence.
    if (handoff.persistPayloadTo === "issueStore") {
      await this.#deps.issueStore.writeWorkflowPayload(
        input.issueNumber,
        input.workflowId,
        payload,
      );
    }

    this.#deps.logger?.info(
      {
        handoffId: handoff.id,
        workflowId: input.workflowId,
        sourceAgent: input.sourceAgent,
        sourceOutcome: input.sourceOutcome,
        artifactPath,
        persistPayloadTo: handoff.persistPayloadTo,
      },
      "handoff.emit.completed",
    );

    return { payload, artifactPath };
  }

  #resolveExpression(
    expr: string,
    ctx: ResolveContext,
    handoffId: string,
    key: string,
  ): unknown {
    // Literal: single-quoted string. No type inference; schema coerces.
    if (expr.length >= 2 && expr.startsWith("'") && expr.endsWith("'")) {
      return expr.slice(1, -1);
    }

    if (!expr.startsWith("$.")) {
      throw new HandoffResolveError(
        handoffId,
        key,
        expr,
        "expression must start with '$.' or be a single-quoted literal",
      );
    }

    const remainder = expr.slice(2);
    const dotIdx = remainder.indexOf(".");
    const bracketIdx = remainder.indexOf("[");
    const rootEnd = dotIdx < 0
      ? bracketIdx
      : bracketIdx < 0
      ? dotIdx
      : Math.min(dotIdx, bracketIdx);
    if (rootEnd < 0) {
      throw new HandoffResolveError(
        handoffId,
        key,
        expr,
        "expression missing path segment after root",
      );
    }
    const root = remainder.slice(0, rootEnd) as Root;
    const rest = remainder.slice(rootEnd);

    const value = resolveRoot(root, rest, ctx, handoffId, key, expr);
    if (value === undefined) {
      throw new HandoffResolveError(handoffId, key, expr);
    }
    return value;
  }
}

// =============================================================================
// Resolver helpers (pure)
// =============================================================================

function resolveRoot(
  root: Root,
  rest: string,
  ctx: ResolveContext,
  handoffId: string,
  key: string,
  expr: string,
): unknown {
  switch (root) {
    case "agent":
      return resolveAgent(rest, ctx, handoffId, key, expr);
    case "github":
      return resolveGithub(rest, ctx, handoffId, key, expr);
    case "workflow":
      return resolveWorkflow(rest, ctx, handoffId, key, expr);
    default:
      throw new HandoffResolveError(
        handoffId,
        key,
        expr,
        `unknown root '${root}'`,
      );
  }
}

function resolveAgent(
  rest: string,
  ctx: ResolveContext,
  handoffId: string,
  key: string,
  expr: string,
): unknown {
  // Expected: .result.<fieldPath>
  if (!rest.startsWith(".result")) {
    throw new HandoffResolveError(
      handoffId,
      key,
      expr,
      "only $.agent.result.* is supported",
    );
  }
  const after = rest.slice(".result".length);
  if (after === "") return ctx.agent.result;
  if (!after.startsWith(".")) {
    throw new HandoffResolveError(handoffId, key, expr, "malformed agent path");
  }
  return walkDottedPath(ctx.agent.result, after.slice(1));
}

function resolveGithub(
  rest: string,
  ctx: ResolveContext,
  handoffId: string,
  key: string,
  expr: string,
): unknown {
  if (!rest.startsWith(".pr")) {
    throw new HandoffResolveError(
      handoffId,
      key,
      expr,
      "only $.github.pr.* is supported",
    );
  }
  const after = rest.slice(".pr".length);
  if (ctx.github.pr === undefined) {
    // Pre-scan missed this expression: implementation bug.
    throw new HandoffResolveError(
      handoffId,
      key,
      expr,
      "github PR metadata unavailable (pre-scan miss)",
    );
  }
  if (after === "") return ctx.github.pr;
  if (!after.startsWith(".")) {
    throw new HandoffResolveError(
      handoffId,
      key,
      expr,
      "malformed github path",
    );
  }
  return walkDottedPath(
    ctx.github.pr as unknown as Record<string, unknown>,
    after.slice(1),
  );
}

function resolveWorkflow(
  rest: string,
  ctx: ResolveContext,
  handoffId: string,
  key: string,
  expr: string,
): unknown {
  if (rest.startsWith(".context")) {
    const after = rest.slice(".context".length);
    if (after === "") return ctx.workflow.context;
    if (!after.startsWith(".")) {
      throw new HandoffResolveError(
        handoffId,
        key,
        expr,
        "malformed workflow.context path",
      );
    }
    return walkDottedPath(
      ctx.workflow.context as unknown as Record<string, unknown>,
      after.slice(1),
    );
  }

  if (rest.startsWith(".agents[")) {
    // Shape: .agents[<id|sourceAgent>].<field>
    const closeIdx = rest.indexOf("]");
    if (closeIdx < 0) {
      throw new HandoffResolveError(
        handoffId,
        key,
        expr,
        "missing ']' after agents[",
      );
    }
    const rawId = rest.slice(".agents[".length, closeIdx);
    const agentId = rawId === "sourceAgent" ? ctx.agent.id : rawId;
    const after = rest.slice(closeIdx + 1);
    const agentInfo = ctx.workflow.agents[agentId];
    if (agentInfo === undefined) {
      throw new HandoffResolveError(
        handoffId,
        key,
        expr,
        `workflow agent '${agentId}' not found`,
      );
    }
    if (after === "") return agentInfo;
    if (!after.startsWith(".")) {
      throw new HandoffResolveError(
        handoffId,
        key,
        expr,
        "malformed workflow.agents path",
      );
    }
    return walkDottedPath(
      agentInfo as unknown as Record<string, unknown>,
      after.slice(1),
    );
  }

  throw new HandoffResolveError(
    handoffId,
    key,
    expr,
    "only $.workflow.context.* and $.workflow.agents[<id>].* are supported",
  );
}

function walkDottedPath(
  root: Readonly<Record<string, unknown>>,
  path: string,
): unknown {
  if (path === "") return root;
  const segments = path.split(".");
  let cursor: unknown = root;
  for (const seg of segments) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[seg];
    if (cursor === undefined) return undefined;
  }
  return cursor;
}

// =============================================================================
// Template helpers (pure)
// =============================================================================

const PAYLOAD_TEMPLATE_RE = /\$\{payload\.([a-zA-Z0-9_\-]+)\}/g;

function containsPayloadTemplate(expr: string): boolean {
  return expr.includes("${payload.");
}

/**
 * Substitute `${payload.<key>}` occurrences using the provided payload.
 * Missing keys throw {@link HandoffResolveError}. Values are stringified
 * via `String(...)` which matches the contract that literals are strings
 * and path segments are scalar by design.
 */
function renderPayloadTemplate(
  template: string,
  payload: Record<string, unknown>,
  handoffId: string,
  key: string,
): string {
  let missing: string | null = null;
  const rendered = template.replace(PAYLOAD_TEMPLATE_RE, (_match, refKey) => {
    if (!(refKey in payload)) {
      missing = refKey;
      return "";
    }
    const value = payload[refKey];
    if (value === undefined || value === null) {
      missing = refKey;
      return "";
    }
    return String(value);
  });
  if (missing !== null) {
    throw new HandoffResolveError(
      handoffId,
      key,
      template,
      `payload key '${missing}' not resolved`,
    );
  }
  return rendered;
}
