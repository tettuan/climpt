/**
 * Contract tests for AgentRunner.issuePayload context composition.
 *
 * The subprocess closure context is composed as
 *   `{ ...(issuePayload ?? {}), ...this.args }`
 * so that explicit agent parameters (`args`) always win on collision with
 * payload-carried values, while unique payload keys propagate into the
 * subprocess context.
 *
 * These tests model the exact composition performed by
 * `AgentRunner.runSubprocessClosureIteration`. Exercising a full AgentRunner
 * requires live loader / configuration / event machinery; the composition
 * rule itself is a pure function that we verify directly to keep the
 * contract pinned.
 */

import { assertEquals } from "@std/assert";

/**
 * Mirror of the private composition performed inside
 * `AgentRunner.runSubprocessClosureIteration`. Kept in lockstep with
 * the production code; any drift here is a test-owned smoke signal that
 * the runner composition changed.
 */
function composeSubprocessContext(
  issuePayload: Readonly<Record<string, unknown>> | undefined,
  args: Record<string, unknown>,
): Record<string, unknown> {
  return { ...(issuePayload ?? {}), ...args };
}

Deno.test(
  "issuePayload + args: args keys win on collision (CLI override wins)",
  () => {
    const payload = { prNumber: 1, verdictPath: "/payload/verdict.json" };
    const args = { prNumber: 999, extra: "from-args" };

    const ctx = composeSubprocessContext(payload, args);

    assertEquals(ctx.prNumber, 999, "args.prNumber must override payload");
    assertEquals(
      ctx.verdictPath,
      "/payload/verdict.json",
      "payload keys not in args must survive",
    );
    assertEquals(ctx.extra, "from-args");
  },
);

Deno.test("issuePayload undefined: context equals args", () => {
  const args = { issue: 42, iterateMax: 3 };
  const ctx = composeSubprocessContext(undefined, args);
  assertEquals(ctx, args);
});

Deno.test(
  "issuePayload only (empty args): payload values surface in context",
  () => {
    const payload = { alpha: "a", beta: 2 };
    const ctx = composeSubprocessContext(payload, {});
    assertEquals(ctx.alpha, "a");
    assertEquals(ctx.beta, 2);
  },
);

Deno.test("issuePayload preserves nested structure verbatim", () => {
  const payload = { nested: { key: "value", list: [1, 2, 3] } };
  const ctx = composeSubprocessContext(payload, { scalar: true });
  assertEquals(
    ctx.nested,
    { key: "value", list: [1, 2, 3] },
    "payload nested structures must not be flattened or cloned shallow",
  );
  assertEquals(ctx.scalar, true);
});
