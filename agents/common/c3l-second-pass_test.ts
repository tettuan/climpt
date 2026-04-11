/**
 * Issue #464 reproduction test: C3L prompt resolution fails on 2nd pass
 *
 * Scenario: Same agent called twice in the same Deno process.
 * 1st pass: initial + continuation both succeed.
 * 2nd pass: initial succeeds, continuation fails with PR-C3L-004.
 *
 * Test levels:
 * - Level 1: C3LPromptLoader alone (no cwd disruption)
 * - Level 2: C3LPromptLoader with Deno.chdir between load() calls
 *            (simulates SDK query changing cwd)
 * - Level 3: C3LPromptLoader with Deno.chdir to a DIFFERENT directory
 *            between passes (simulates 1st run leaving cwd dirty)
 *
 * @design_ref docs/guides/en/12-troubleshooting.md#44-c3l-prompt-file-not-found
 */

import { assert, assertEquals } from "@std/assert";
import { C3LPromptLoader } from "./c3l-prompt-loader.ts";
import type { C3LPath, PromptLoadResult } from "./c3l-prompt-loader.ts";
import { BreakdownLogger } from "@tettuan/breakdownlogger";

const logger = new BreakdownLogger("fix-464");

const AGENT_ID = "reviewer";
const CONFIG_SUFFIX = "steps";

const INITIAL: C3LPath = { c1: "steps", c2: "initial", c3: "issue" };
const CONTINUATION: C3LPath = {
  c1: "steps",
  c2: "continuation",
  c3: "issue",
};

const UV = { issue: "999" };

function logResult(label: string, result: PromptLoadResult): void {
  logger.debug(label, {
    ok: result.ok,
    hasContent: !!result.content,
    contentLength: result.content?.length ?? 0,
    error: result.error ?? null,
    promptPath: result.promptPath ?? null,
    cwdAtLog: Deno.cwd(),
  });
}

/**
 * Single pass: load initial then continuation.
 * Optionally disrupts cwd between the two loads to simulate SDK query.
 */
async function runPass(
  passLabel: string,
  options?: { disruptCwdBetweenLoads?: string },
): Promise<{ initial: PromptLoadResult; continuation: PromptLoadResult }> {
  const loader = new C3LPromptLoader({
    agentId: AGENT_ID,
    configSuffix: CONFIG_SUFFIX,
  });

  logger.debug(`${passLabel} start`, {
    configName: loader.getConfigName(),
    cwd: Deno.cwd(),
  });

  const initial = await loader.load(INITIAL, { uv: UV });
  logResult(`${passLabel} initial`, initial);

  // Simulate SDK query changing cwd (if requested)
  if (options?.disruptCwdBetweenLoads) {
    const before = Deno.cwd();
    Deno.chdir(options.disruptCwdBetweenLoads);
    logger.debug(`${passLabel} cwd disrupted`, {
      before,
      after: Deno.cwd(),
    });
  }

  const continuation = await loader.load(CONTINUATION, { uv: UV });
  logResult(`${passLabel} continuation`, continuation);

  logger.debug(`${passLabel} end`, { cwd: Deno.cwd() });

  return { initial, continuation };
}

// ----------------------------------------------------------------------------
// Tests: increasing specificity (existence → contract → reproduction)
// ----------------------------------------------------------------------------

Deno.test("fix-464: single pass resolves both initial and continuation", async () => {
  const { initial, continuation } = await runPass("1st-pass");

  assert(initial.ok, `initial failed: ${initial.error}`);
  assert(continuation.ok, `continuation failed: ${continuation.error}`);
});

Deno.test("fix-464: second pass resolves both initial and continuation", async () => {
  // 1st pass — populate any breakdown internal caches
  const pass1 = await runPass("1st-pass");
  assert(pass1.initial.ok, `1st pass initial failed: ${pass1.initial.error}`);
  assert(
    pass1.continuation.ok,
    `1st pass continuation failed: ${pass1.continuation.error}`,
  );

  // 2nd pass — new loader instance, same Deno process
  const pass2 = await runPass("2nd-pass");

  logger.debug("comparison", {
    pass1_initial_ok: pass1.initial.ok,
    pass1_continuation_ok: pass1.continuation.ok,
    pass2_initial_ok: pass2.initial.ok,
    pass2_continuation_ok: pass2.continuation.ok,
  });

  assert(pass2.initial.ok, `2nd pass initial failed: ${pass2.initial.error}`);
  assert(
    pass2.continuation.ok,
    `2nd pass continuation failed: ${pass2.continuation.error}`,
  );
});

Deno.test("fix-464: five consecutive passes all succeed", async () => {
  const results: boolean[] = [];

  for (let i = 1; i <= 5; i++) {
    const { initial, continuation } = await runPass(`pass-${i}`);
    results.push(initial.ok && continuation.ok);

    logger.debug(`pass-${i} outcome`, {
      initial_ok: initial.ok,
      continuation_ok: continuation.ok,
      initial_error: initial.error ?? null,
      continuation_error: continuation.error ?? null,
    });
  }

  assertEquals(
    results.filter((r) => r).length,
    5,
    `Expected all 5 passes to succeed, got: ${JSON.stringify(results)}`,
  );
});

// ----------------------------------------------------------------------------
// Level 2: cwd disruption between initial and continuation loads
// Simulates SDK query() changing Deno.cwd() during agent execution
// ----------------------------------------------------------------------------

Deno.test("fix-464: cwd disrupted to /tmp between loads still resolves", async () => {
  const originalCwd = Deno.cwd();
  try {
    const { initial, continuation } = await runPass("cwd-disrupted", {
      disruptCwdBetweenLoads: Deno.env.get("TMPDIR") ?? "/tmp",
    });

    assert(initial.ok, `initial failed: ${initial.error}`);
    assert(
      continuation.ok,
      `continuation failed after cwd disruption: ${continuation.error}`,
    );
  } finally {
    Deno.chdir(originalCwd);
  }
});

Deno.test("fix-464: cwd disrupted to parent dir between loads still resolves", async () => {
  const originalCwd = Deno.cwd();
  try {
    const { initial, continuation } = await runPass("cwd-parent", {
      disruptCwdBetweenLoads: "..",
    });

    assert(initial.ok, `initial failed: ${initial.error}`);
    assert(
      continuation.ok,
      `continuation failed after cwd disruption to parent: ${continuation.error}`,
    );
  } finally {
    Deno.chdir(originalCwd);
  }
});

// ----------------------------------------------------------------------------
// Level 3: cwd disrupted BETWEEN passes (1st pass leaves cwd dirty)
// Simulates 1st deno task agent run leaving cwd in unexpected state
// ----------------------------------------------------------------------------

Deno.test("fix-464: 2nd pass after cwd left dirty by 1st pass", async () => {
  const originalCwd = Deno.cwd();
  try {
    // 1st pass with cwd disruption (simulates SDK changing cwd)
    const pass1 = await runPass("dirty-1st-pass", {
      disruptCwdBetweenLoads: Deno.env.get("TMPDIR") ?? "/tmp",
    });
    assert(pass1.initial.ok, `1st pass initial failed: ${pass1.initial.error}`);
    assert(
      pass1.continuation.ok,
      `1st pass continuation failed: ${pass1.continuation.error}`,
    );

    // cwd is now dirty (TMPDIR), do NOT restore before 2nd pass
    logger.debug("between passes", { cwd: Deno.cwd() });

    // 2nd pass from dirty cwd — new loader instance
    const pass2 = await runPass("dirty-2nd-pass");

    logger.debug("dirty comparison", {
      pass1_continuation_ok: pass1.continuation.ok,
      pass2_continuation_ok: pass2.continuation.ok,
      cwdBeforePass2: Deno.cwd(),
    });

    assert(
      pass2.initial.ok,
      `2nd pass initial failed from dirty cwd: ${pass2.initial.error}`,
    );
    assert(
      pass2.continuation.ok,
      `2nd pass continuation failed from dirty cwd: ${pass2.continuation.error}`,
    );
  } finally {
    Deno.chdir(originalCwd);
  }
});

Deno.test("fix-464: 2nd pass after cwd left in .agent subdir", async () => {
  const originalCwd = Deno.cwd();
  try {
    // 1st pass normal
    const pass1 = await runPass("subdir-1st-pass");
    assert(pass1.initial.ok);
    assert(pass1.continuation.ok);

    // Leave cwd in .agent/reviewer (simulates agent tool execution in agent dir)
    Deno.chdir(".agent/reviewer");
    logger.debug("cwd moved to agent dir", { cwd: Deno.cwd() });

    // 2nd pass from .agent/reviewer — loader has NO explicit workingDir
    const pass2 = await runPass("subdir-2nd-pass");

    assert(
      pass2.initial.ok,
      `2nd pass initial failed from .agent subdir: ${pass2.initial.error}`,
    );
    assert(
      pass2.continuation.ok,
      `2nd pass continuation failed from .agent subdir: ${pass2.continuation.error}`,
    );
  } finally {
    Deno.chdir(originalCwd);
  }
});
