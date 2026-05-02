/**
 * Shared runner test harness for repeat-choice / cursor / fallback-cap tests.
 *
 * Purpose:
 *   Build a real {@link AgentRunner} wired to fake LLM/SDK boundaries so
 *   integration tests can drive iterations one prompt at a time and observe
 *   internal state (cursor advances, pending adaptation, prompt seen by the
 *   query layer) without modifying production code.
 *
 * Boundary stubbed:
 *   - Logger / VerdictHandler / PromptResolver factories (via injected
 *     {@link AgentDependencies}) — same boundary used by
 *     `runner-loop-integration_test.ts`.
 *   - `closureManager.initializeValidation` — replaced with a synchronous
 *     installer that drops a caller-supplied `ExtendedStepsRegistry` in
 *     place. Production code path (filesystem registry load) is bypassed.
 *   - `closureManager.stepPromptResolver` — single-shot resolver returning
 *     a marked prompt; the harness records the resolved prompt per
 *     iteration via {@link RunnerHarnessOpts.observe.promptObserved}.
 *   - `runner.resolveSystemPromptForIteration` — bypasses prompts/system.md.
 *   - `QueryExecutor.executeQuery` — replaced with a scripted summary
 *     producer (see {@link RunnerHarnessOpts.scriptedSummaries}).
 *
 * The {@link AgentRunner} class itself is NOT mocked.
 *
 * Deviation note: the requested `observe.cursorAfterEach` /
 * `pendingAdaptationAfterEach` hooks are surfaced via the cursor's
 * production telemetry sink ({@link AdaptationCursor.setLogSink}) and a
 * post-iteration `pendingAdaptation` read, both stitched onto the
 * runner's iterationEnd lifecycle event. Production code already exposes
 * setLogSink — no production change needed.
 */

import { AgentRunner } from "../runner.ts";
import { StepGateInterpreter } from "../step-gate-interpreter.ts";
import { WorkflowRouter } from "../workflow-router.ts";
import type { AgentDependencies } from "../builder.ts";
import type { QueryExecutor } from "../query-executor.ts";
import type {
  IterationSummary,
  ResolvedAgentDefinition,
  RuntimeContext,
} from "../../src_common/types.ts";
import type { VerdictHandler } from "../../verdict/types.ts";
import {
  type ExtendedStepsRegistry,
  hasFlowRoutingSupport,
} from "../../common/validation-types.ts";
import type {
  AdaptationCursor as AdaptationCursorType,
  AdaptationCursorLogSink,
  AdaptationLogFields,
} from "../adaptation-cursor.ts";

/**
 * Discriminator for the prompt the harness inserts into the resolved
 * Flow Loop prompt content. The runner calls `closureManager
 * .resolveFlowStepPrompt(stepId, uvVars, { adaptation })`; the harness
 * routes the adaptation override into the resolved prompt text so the
 * adaptation actually consumed for an iteration is observable from
 * outside. The discriminator is `<stepId>|adaptation=<value|undefined>`.
 */
export function buildHarnessPromptMarker(
  stepId: string,
  adaptation: string | undefined,
): string {
  return `${stepId}|adaptation=${adaptation ?? "undefined"}`;
}

/** Sentinel substring inside an executed prompt that decodes the adaptation. */
const ADAPTATION_KEY = "|adaptation=";

/** Decode the adaptation slot from a prompt produced by this harness. */
export function decodeAdaptationFromPrompt(
  prompt: string,
): string | undefined {
  const idx = prompt.indexOf(ADAPTATION_KEY);
  if (idx < 0) return undefined;
  const tail = prompt.slice(idx + ADAPTATION_KEY.length);
  // Marker may be embedded in a longer stub body — split on first newline/space.
  const value = tail.split(/[\s\n]/, 1)[0] ?? "";
  return value === "undefined" ? undefined : value;
}

/**
 * Telemetry event recorded by the cursor sink. Mirrors §2.5 field shape
 * verbatim; the test reads `chainPosition` / `toAdaptation` / `message`.
 */
export interface CursorEvent {
  level: "debug" | "warn" | "error";
  message: string;
  fields: AdaptationLogFields;
}

/**
 * Iteration observation snapshot, emitted from `iterationEnd`.
 * The harness fires this once per iteration after the runner's loop body
 * has finished its post-iteration bookkeeping (so cursor/pendingAdaptation
 * reflect the just-finished iteration's effects).
 */
export interface IterationObservation {
  iteration: number;
  /** Adaptation read by the prompt resolver (decoded from the executed prompt). */
  promptAdaptation: string | undefined;
  /** `pendingAdaptation` slot at end of iteration (private field read via test seam). */
  pendingAdaptation: { stepId: string; adaptation: string } | null;
  /** Cursor §2.5 events emitted during the iteration. */
  cursorEvents: CursorEvent[];
}

/** Options for {@link makeRunnerHarness}. */
export interface RunnerHarnessOpts {
  stepsRegistry: ExtendedStepsRegistry;
  /** Round-robined when iteration count exceeds list length. */
  scriptedSummaries: IterationSummary[];
  /** When undefined, the runner uses `AGENT_LIMITS.FALLBACK_MAX_ITERATIONS`. */
  maxIterations?: number;
  /** Optional verdict-handler script. Defaults to "never finished" (loop exhausts via maxIterations). */
  verdictFinishedSequence?: boolean[];
  observe?: {
    promptObserved?: (
      iteration: number,
      prompt: string,
      type: "retry" | "initial" | "continuation",
    ) => void;
    /** Fires once per iteration with the decoded snapshot. */
    iterationObserved?: (snapshot: IterationObservation) => void;
  };
}

/** Built harness wiring exposed for assertion. */
export interface RunnerHarness {
  runner: AgentRunner;
  /** Run the harness; resolves with the final {@link AgentRunner.run} result. */
  run: () => ReturnType<AgentRunner["run"]>;
  /** Snapshots accumulated across the run, in iteration order. */
  observations: IterationObservation[];
  /** Raw §2.5 events captured by the cursor sink, run-wide. */
  cursorEvents: CursorEvent[];
}

/**
 * Minimal {@link ResolvedAgentDefinition}. `verdict.config.maxIterations`
 * is left undefined when {@link RunnerHarnessOpts.maxIterations} is
 * undefined so {@link AgentRunner.getMaxIterations} falls through to
 * `AGENT_LIMITS.FALLBACK_MAX_ITERATIONS` (the G4 invariant).
 */
function buildDefinition(
  maxIterations: number | undefined,
): ResolvedAgentDefinition {
  const verdictConfig: Record<string, unknown> = {};
  if (maxIterations !== undefined) {
    verdictConfig.maxIterations = maxIterations;
  }
  return {
    name: "harness-test",
    displayName: "Harness Test Agent",
    description: "Repeat-choice harness fixture",
    version: "1.0.0",
    parameters: {},
    runner: {
      flow: {
        systemPromptPath: "./prompts/system.md",
        prompts: { registry: "steps_registry.json", fallbackDir: "./prompts" },
      },
      verdict: {
        type: "count:iteration",
        config: verdictConfig,
      },
      execution: {},
      logging: {
        directory: "./logs/harness",
        format: "jsonl",
      },
    },
  };
}

/** Mock logger compatible with `RuntimeContext["logger"]`. */
function buildMockLogger(): RuntimeContext["logger"] {
  const noop = (_msg: string, _data?: unknown) => {};
  return {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    log: () => Promise.resolve(),
    flush: () => Promise.resolve(),
    close: () => Promise.resolve(),
    addContext: () => {},
    getLogPath: () => "./logs/harness/mock.log",
    logSdkMessage: () => {},
    setToolContext: () => {},
    clearToolContext: () => {},
  } as unknown as RuntimeContext["logger"];
}

/**
 * VerdictHandler that returns a pre-scripted finished sequence.
 * The harness uses this as a stop-condition only; tests that need the
 * loop to terminate exclusively at maxIterations leave the sequence as
 * `[false]` (round-robined → always not finished).
 */
function buildVerdictHandler(
  finishedSequence: boolean[],
): VerdictHandler {
  let i = 0;
  return {
    type: "count:iteration",
    buildInitialPrompt: () => Promise.resolve(""),
    buildContinuationPrompt: () => Promise.resolve(""),
    buildVerdictCriteria: () => ({ short: "harness", detailed: "harness" }),
    isFinished: () => {
      const value = finishedSequence[Math.min(i, finishedSequence.length - 1)];
      i++;
      return Promise.resolve(value);
    },
    getVerdictDescription: () => Promise.resolve("harness verdict"),
    getLastVerdict: () => undefined,
    setCurrentSummary: () => {},
  };
}

function buildDependencies(
  logger: RuntimeContext["logger"],
  verdict: VerdictHandler,
): AgentDependencies {
  return {
    loggerFactory: { create: () => Promise.resolve(logger) },
    verdictHandlerFactory: { create: () => Promise.resolve(verdict) },
    promptResolverFactory: {
      create: () =>
        Promise.resolve(
          {
            resolve: () =>
              Promise.resolve({
                content: "harness fallback prompt",
                source: "user" as const,
                promptPath: "harness",
              }),
          } as unknown as import("../../common/prompt-resolver.ts").PromptResolver,
        ),
    },
  };
}

/** Round-robin {@link IterationSummary} scripter. */
function pickSummary(
  summaries: IterationSummary[],
  callIndex: number,
): IterationSummary {
  if (summaries.length === 0) {
    throw new Error(
      "harness: scriptedSummaries must contain at least 1 summary",
    );
  }
  return summaries[callIndex % summaries.length];
}

/**
 * Build the harness. Returns a runner ready to {@link AgentRunner.run}
 * plus accumulators populated as the run progresses.
 */
export function makeRunnerHarness(opts: RunnerHarnessOpts): RunnerHarness {
  const definition = buildDefinition(opts.maxIterations);
  const mockLogger = buildMockLogger();
  const verdictHandler = buildVerdictHandler(
    opts.verdictFinishedSequence ?? [false],
  );
  const deps = buildDependencies(mockLogger, verdictHandler);
  const runner = new AgentRunner(definition, deps);

  // Pull the run-scoped cursor up front so wiring later in this function
  // can reference it without a forward closure (also avoids `any`).
  // deno-lint-ignore no-explicit-any
  const cursor: AdaptationCursorType = (runner as any).adaptationCursor;

  // ---- Step registry installation (no-FS) ---------------------------------
  // deno-lint-ignore no-explicit-any
  const cm = (runner as any).closureManager;
  cm.initializeValidation = () => {
    cm.stepsRegistry = opts.stepsRegistry;
    // When any step declares `structuredGate`, install the production
    // FlowRouting components so the runner observes intents. This mirrors
    // the production wiring in closure-manager.ts:234-244 (sans
    // FS-dependent validators) — without it, hasFlowRoutingEnabled()
    // returns false and `intent === "repeat"` never queues
    // pendingAdaptation, breaking the consume-once invariant.
    if (hasFlowRoutingSupport(opts.stepsRegistry)) {
      cm.stepGateInterpreter = new StepGateInterpreter();
      cm.workflowRouter = new WorkflowRouter(
        opts.stepsRegistry,
        undefined,
        cursor,
      );
    }
    return Promise.resolve();
  };

  // ---- StepPromptResolver: encodes adaptation slot into prompt content ----
  // Production resolver signature: `resolve(stepId, { uv }, overrides?)`
  // (see closure-manager.ts:440 and closure-adapter.ts:95). The harness
  // matches that exactly so closure + flow paths both reach this stub.
  cm.stepPromptResolver = {
    resolve: (
      stepId: string,
      _vars: { uv?: Record<string, string> },
      overrides?: { adaptation?: string },
    ) => {
      const adaptation = overrides?.adaptation;
      return Promise.resolve({
        content: buildHarnessPromptMarker(stepId, adaptation),
        source: "user" as const,
        promptPath: "harness-step",
      });
    },
  };

  // ---- System prompt resolution stub (no-FS) ------------------------------
  // deno-lint-ignore no-explicit-any
  (runner as any).resolveSystemPromptForIteration = () =>
    Promise.resolve({
      type: "preset",
      preset: "claude_code",
      append: "harness system prompt",
    });

  // ---- Cursor telemetry sink ----------------------------------------------
  // The runner calls `adaptationCursor.setLogSink(logger, runId)` inside
  // `initialize()` and that wiring takes precedence over any earlier sink.
  // We monkey-patch `setLogSink` on the cursor instance so the production
  // wire-up is preserved AND our recorder fans out the same events.
  const cursorEvents: CursorEvent[] = [];
  const collectingSink: AdaptationCursorLogSink = {
    debug: (message: string, fields?: Record<string, unknown>) =>
      cursorEvents.push({
        level: "debug",
        message,
        fields: fields as AdaptationLogFields,
      }),
    warn: (message: string, fields?: Record<string, unknown>) =>
      cursorEvents.push({
        level: "warn",
        message,
        fields: fields as AdaptationLogFields,
      }),
    error: (message: string, fields?: Record<string, unknown>) =>
      cursorEvents.push({
        level: "error",
        message,
        fields: fields as AdaptationLogFields,
      }),
  };
  const originalSetLogSink = cursor.setLogSink.bind(cursor);
  cursor.setLogSink = (
    sink: AdaptationCursorLogSink,
    agentRunId: string | undefined,
  ) => {
    // Combined sink: production sink first (preserves wiring), then collector.
    const fanOut: AdaptationCursorLogSink = {
      debug: (m, d) => {
        sink.debug(m, d);
        collectingSink.debug(m, d);
      },
      warn: (m, d) => {
        sink.warn(m, d);
        collectingSink.warn(m, d);
      },
      error: (m, d) => {
        sink.error(m, d);
        collectingSink.error(m, d);
      },
    };
    originalSetLogSink(fanOut, agentRunId);
  };

  // ---- Per-iteration observation state ------------------------------------
  const observations: IterationObservation[] = [];
  let iterationCursorBaseline = 0;
  let lastPromptAdaptation: string | undefined = undefined;
  let lastPromptIteration = -1;

  // ---- QueryExecutor stub --------------------------------------------------
  // After T4 the runner lazily builds its QueryExecutor; the canonical
  // pattern (mirrored from runner-loop-integration_test.ts) is to replace
  // `ensureQueryExecutor` with a factory returning the stub.
  let callIndex = 0;
  const stubExecutor = {
    executeQuery: (options: { prompt: string; iteration: number }) => {
      const summary = pickSummary(opts.scriptedSummaries, callIndex);
      callIndex++;
      // Promote iteration into summary so the runner's bookkeeping matches.
      const adapted: IterationSummary = {
        ...summary,
        iteration: options.iteration,
      };
      // Capture the prompt's decoded adaptation slot for iterationEnd
      // observation, then forward to the user's promptObserved callback.
      lastPromptAdaptation = decodeAdaptationFromPrompt(options.prompt);
      lastPromptIteration = options.iteration;
      opts.observe?.promptObserved?.(
        options.iteration,
        options.prompt,
        "initial",
      );
      return Promise.resolve(adapted);
    },
  } as unknown as QueryExecutor;
  // deno-lint-ignore no-explicit-any
  (runner as any).ensureQueryExecutor = () => Promise.resolve(stubExecutor);
  // deno-lint-ignore no-explicit-any
  (runner as any).queryExecutor = stubExecutor;

  runner.on("iterationStart", () => {
    iterationCursorBaseline = cursorEvents.length;
  });
  runner.on("iterationEnd", (payload) => {
    const iteration = payload.iteration;
    // deno-lint-ignore no-explicit-any
    const pending = (runner as any).pendingAdaptation as
      | { stepId: string; adaptation: string }
      | null;
    const snapshot: IterationObservation = {
      iteration,
      promptAdaptation: lastPromptIteration === iteration
        ? lastPromptAdaptation
        : undefined,
      pendingAdaptation: pending ? { ...pending } : null,
      cursorEvents: cursorEvents.slice(iterationCursorBaseline),
    };
    observations.push(snapshot);
    opts.observe?.iterationObserved?.(snapshot);
  });

  return {
    runner,
    run: () =>
      runner.run({
        args: {},
        cwd: "./logs/harness/cwd",
      }),
    observations,
    cursorEvents,
  };
}
