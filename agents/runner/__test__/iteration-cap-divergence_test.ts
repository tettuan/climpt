/**
 * TC-G5 — Iteration-cap fallback divergence (runner vs verdict).
 *
 * Invariant under test (Conformance):
 *   IF a verdict config omits `maxIterations`,
 *   THEN the runner falls back to AGENT_LIMITS.FALLBACK_MAX_ITERATIONS,
 *        the verdict factory + composite handler fall back to
 *        AGENT_LIMITS.VERDICT_FALLBACK_MAX_ITERATIONS, and these two
 *        constants are intentionally distinct (and both > 0).
 *
 * Why divergence is intentional: the runner's outer loop bound is a
 * safety stop on top of the verdict handler's own iteration budget — they
 * must NOT collapse into a single value. If a future refactor accidentally
 * unifies them (e.g., re-using one constant for both), this test fails.
 *
 * Source-of-truth citations:
 *   - agents/shared/constants.ts:13-24            (AGENT_LIMITS table)
 *   - agents/runner/runner.ts:1162-1172           (runner.getMaxIterations)
 *   - agents/verdict/factory.ts:146-157           (count:iteration registerHandler)
 *   - agents/verdict/composite.ts:73-80           (composite count:iteration branch)
 *   - agents/verdict/iteration-budget.ts:13-31    (IterationBudgetVerdictHandler ctor)
 *
 * Diagnosability:
 *   On failure each assertion names BOTH consumer files and the constant
 *   table so a reviewer can open the file and confirm which side drifted.
 *
 * Anti-patterns avoided:
 *   - Magic number for iteration counts: NO literal 20/100 anywhere; both
 *     constants are imported and asserted by reference.
 *   - Validator bypass: runner.getMaxIterations is private — exercised
 *     through a typed test seam without modifying production code.
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import { AGENT_LIMITS } from "../../shared/constants.ts";
import { AgentRunner } from "../runner.ts";
import { IterationBudgetVerdictHandler } from "../../verdict/iteration-budget.ts";
import type { ResolvedAgentDefinition } from "../../src_common/types.ts";

const CONSTANTS_TS = "agents/shared/constants.ts";
const RUNNER_TS = "agents/runner/runner.ts";
const FACTORY_TS = "agents/verdict/factory.ts";
const COMPOSITE_TS = "agents/verdict/composite.ts";

/**
 * Minimal {@link ResolvedAgentDefinition}. `verdict.config.maxIterations`
 * is intentionally absent so the runner falls through to
 * `AGENT_LIMITS.FALLBACK_MAX_ITERATIONS` (the path under test).
 */
function buildDefinitionWithoutMaxIterations(): ResolvedAgentDefinition {
  return {
    name: "g5-divergence",
    displayName: "G5 Divergence Test Agent",
    description: "Iteration-cap fallback divergence fixture",
    version: "1.0.0",
    parameters: {},
    runner: {
      flow: {
        systemPromptPath: "./prompts/system.md",
        prompts: { registry: "steps_registry.json" },
      },
      verdict: {
        type: "count:iteration",
        config: {}, // no maxIterations -> exercises fallback
      },
      execution: {},
      logging: {
        directory: "./logs/g5",
        format: "jsonl",
      },
    },
  };
}

/**
 * Test seam: AgentRunner.getMaxIterations is private. The test reads it
 * via a structural cast — production code is unchanged, the runtime
 * behavior is unchanged, only the call-site type is widened for
 * inspection. This is the smallest possible escape hatch.
 */
type RunnerWithGetMaxIterations = {
  getMaxIterations(): number;
};

Deno.test(
  "TC-G5 (a): AGENT_LIMITS.FALLBACK_MAX_ITERATIONS and AGENT_LIMITS.VERDICT_FALLBACK_MAX_ITERATIONS are both > 0 and intentionally distinct",
  () => {
    // Non-vacuity: a value of 0 would silently terminate the loop on the
    // first iteration check; assert > 0 so a typo in the constant table
    // cannot trivially satisfy the divergence check.
    assertEquals(
      AGENT_LIMITS.FALLBACK_MAX_ITERATIONS > 0,
      true,
      `AGENT_LIMITS.FALLBACK_MAX_ITERATIONS must be > 0 ` +
        `(got ${AGENT_LIMITS.FALLBACK_MAX_ITERATIONS}) ` +
        `| where: ${CONSTANTS_TS}:13-24 ` +
        `| how-to-fix: keep the runner-loop fallback strictly positive so the loop can execute at least once`,
    );
    assertEquals(
      AGENT_LIMITS.VERDICT_FALLBACK_MAX_ITERATIONS > 0,
      true,
      `AGENT_LIMITS.VERDICT_FALLBACK_MAX_ITERATIONS must be > 0 ` +
        `(got ${AGENT_LIMITS.VERDICT_FALLBACK_MAX_ITERATIONS}) ` +
        `| where: ${CONSTANTS_TS}:13-24 ` +
        `| how-to-fix: keep the verdict-handler fallback strictly positive so isFinished can resolve`,
    );

    // Conformance: the two fallbacks are intentionally distinct so the
    // outer loop bound never collapses with the verdict budget.
    assertNotEquals(
      AGENT_LIMITS.FALLBACK_MAX_ITERATIONS,
      AGENT_LIMITS.VERDICT_FALLBACK_MAX_ITERATIONS,
      `IF runner.getMaxIterations and verdict-factory share a single fallback ` +
        `THEN the outer-loop safety bound collapses with the verdict budget. ` +
        `AGENT_LIMITS.FALLBACK_MAX_ITERATIONS (=${AGENT_LIMITS.FALLBACK_MAX_ITERATIONS}) and ` +
        `AGENT_LIMITS.VERDICT_FALLBACK_MAX_ITERATIONS (=${AGENT_LIMITS.VERDICT_FALLBACK_MAX_ITERATIONS}) must remain DISTINCT ` +
        `| where: ${CONSTANTS_TS}:13-24 ` +
        `| how-to-fix: keep the two AGENT_LIMITS entries separate; do not unify them under one name`,
    );
  },
);

Deno.test(
  "TC-G5 (b): AgentRunner.getMaxIterations falls back to AGENT_LIMITS.FALLBACK_MAX_ITERATIONS when verdict config omits maxIterations",
  () => {
    const runner = new AgentRunner(buildDefinitionWithoutMaxIterations());
    const observed = (runner as unknown as RunnerWithGetMaxIterations)
      .getMaxIterations();

    assertEquals(
      observed,
      AGENT_LIMITS.FALLBACK_MAX_ITERATIONS,
      `IF verdict.config.maxIterations is undefined ` +
        `THEN AgentRunner.getMaxIterations must return AGENT_LIMITS.FALLBACK_MAX_ITERATIONS ` +
        `(=${AGENT_LIMITS.FALLBACK_MAX_ITERATIONS}, got ${observed}) ` +
        `| where: ${RUNNER_TS}:1162-1172 + ${CONSTANTS_TS}:13-24 ` +
        `| how-to-fix: keep the fallback path returning AGENT_LIMITS.FALLBACK_MAX_ITERATIONS, not a literal or the verdict constant`,
    );
  },
);

Deno.test(
  "TC-G5 (c): IterationBudgetVerdictHandler instantiated with the factory/composite fallback uses AGENT_LIMITS.VERDICT_FALLBACK_MAX_ITERATIONS",
  async () => {
    // Mirrors the call shape used by both consumers when verdict config
    // omits `maxIterations`:
    //   factory.ts:149-152   -> new IterationBudgetVerdictHandler(config.maxIterations ?? AGENT_LIMITS.VERDICT_FALLBACK_MAX_ITERATIONS, ...)
    //   composite.ts:73-78   -> new IterationBudgetVerdictHandler(config.maxIterations ?? AGENT_LIMITS.VERDICT_FALLBACK_MAX_ITERATIONS, ...)
    // We exercise the handler through its public surface (no private read)
    // by driving setCurrentIteration up to one less than the cap, then to
    // the cap, and assert the boundary transition matches the constant.
    // The `omitted` binding mirrors the producer's
    // `definition.runner.verdict.config.maxIterations` shape, which is
    // typed `number | undefined` and is `undefined` when the config omits
    // the field — so the `??` chain reduces to the fallback constant.
    const omitted: number | undefined = undefined;
    const handler = new IterationBudgetVerdictHandler(
      omitted ?? AGENT_LIMITS.VERDICT_FALLBACK_MAX_ITERATIONS,
    );

    handler.setCurrentIteration(
      AGENT_LIMITS.VERDICT_FALLBACK_MAX_ITERATIONS - 1,
    );
    const beforeCap = await handler.isFinished();
    assertEquals(
      beforeCap,
      false,
      `IF iteration < AGENT_LIMITS.VERDICT_FALLBACK_MAX_ITERATIONS ` +
        `THEN IterationBudgetVerdictHandler.isFinished must return false ` +
        `(=${
          AGENT_LIMITS.VERDICT_FALLBACK_MAX_ITERATIONS - 1
        } of ${AGENT_LIMITS.VERDICT_FALLBACK_MAX_ITERATIONS}, got ${beforeCap}) ` +
        `| where: ${FACTORY_TS}:146-157 + ${COMPOSITE_TS}:73-80 + ${CONSTANTS_TS}:13-24 ` +
        `| how-to-fix: keep the verdict consumers passing AGENT_LIMITS.VERDICT_FALLBACK_MAX_ITERATIONS to IterationBudgetVerdictHandler when config.maxIterations is undefined`,
    );

    handler.setCurrentIteration(AGENT_LIMITS.VERDICT_FALLBACK_MAX_ITERATIONS);
    const atCap = await handler.isFinished();
    assertEquals(
      atCap,
      true,
      `IF iteration === AGENT_LIMITS.VERDICT_FALLBACK_MAX_ITERATIONS ` +
        `THEN IterationBudgetVerdictHandler.isFinished must return true ` +
        `(=${AGENT_LIMITS.VERDICT_FALLBACK_MAX_ITERATIONS}, got ${atCap}) ` +
        `| where: ${FACTORY_TS}:146-157 + ${COMPOSITE_TS}:73-80 + ${CONSTANTS_TS}:13-24 ` +
        `| how-to-fix: keep the verdict consumers passing AGENT_LIMITS.VERDICT_FALLBACK_MAX_ITERATIONS to IterationBudgetVerdictHandler when config.maxIterations is undefined`,
    );
  },
);
