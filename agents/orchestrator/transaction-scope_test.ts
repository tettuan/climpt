/**
 * Unit tests for TransactionScope.
 *
 * Design reference:
 *   tmp/transaction-rollback/investigation/design.md §4.4
 *
 * The six enumerated observation points from the design doc are covered
 * (T3..T6 failure scenarios, rollback idempotency, partial compensation
 * failure). Additional tests cover the class-level contracts stated in
 * the module-level doc of transaction-scope.ts:
 *   - record() is a no-op after commit or rollback
 *   - rollback() after commit returns an empty report and never throws
 *   - compensationFactory is only invoked after step action success
 *   - LIFO order is honored across 3+ registered compensations
 *   - TransactionLogger.warn is invoked when a compensation throws
 *
 * Testing style:
 *   - Expected labels are held in arrays declared inside each test and
 *     are the single source of truth that both the production call and
 *     the assertion reference; no magic literals in assertions.
 *   - Non-vacuity: every rollback test first asserts that at least one
 *     compensation was attempted before inspecting order, so an
 *     accidentally-empty stack cannot pass silently.
 */

import { assertEquals, assertRejects } from "@std/assert";
import {
  type Compensation,
  type CompensationReport,
  type TransactionLogger,
  TransactionScope,
} from "./transaction-scope.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface RecordingLogger extends TransactionLogger {
  readonly calls: Array<
    { message: string; metadata?: Record<string, unknown> }
  >;
}

function newRecordingLogger(): RecordingLogger {
  const calls: Array<{ message: string; metadata?: Record<string, unknown> }> =
    [];
  return {
    calls,
    warn(message, metadata) {
      calls.push({ message, metadata });
      return Promise.resolve();
    },
  };
}

/**
 * Build a compensation whose run() appends its label to `executionLog`.
 * idempotencyKey is deterministic so assertions can correlate.
 */
function makeCompensation(
  label: string,
  executionLog: string[],
  opts: { throwOnRun?: Error } = {},
): Compensation {
  return {
    label,
    idempotencyKey: `key:${label}`,
    run: () => {
      executionLog.push(label);
      if (opts.throwOnRun) {
        return Promise.reject(opts.throwOnRun);
      }
      return Promise.resolve();
    },
  };
}

// ---------------------------------------------------------------------------
// §4.4 test case 1 — T3 fail: empty registry rollback is a no-op
// ---------------------------------------------------------------------------

Deno.test("T3 fail: rollback with empty registry executes nothing", async () => {
  const tx = new TransactionScope();

  // Simulate T3 (first label-add) throwing before any compensation is recorded.
  const t3Error = new Error("T3 label-add failed");
  await assertRejects(
    () =>
      tx.step(
        "label-add",
        () => Promise.reject(t3Error),
        () => {
          throw new Error(
            "compensationFactory must NOT be invoked when action fails",
          );
        },
      ),
    Error,
    "T3 label-add failed",
  );

  assertEquals(
    tx.pendingCount(),
    0,
    "no compensations should be recorded when the action itself threw",
  );

  const report = await tx.rollback(t3Error);
  assertEquals(report.attempted, 0, "nothing was recorded, nothing to run");
  assertEquals(report.succeeded, 0);
  assertEquals(report.failed.length, 0);
  assertEquals(report.partial, false, "empty rollback is not partial");
  assertEquals(tx.isRolledBack(), true);
});

// ---------------------------------------------------------------------------
// §4.4 test case 2 — T4 fail: T3 compensation (restore-labels-remove) runs
// ---------------------------------------------------------------------------

Deno.test("T4 fail: T3 compensation is executed during rollback", async () => {
  const tx = new TransactionScope();
  const executionLog: string[] = [];
  const expectedOrder = ["restore-labels-remove"];

  // T3 (label-add) succeeds and registers its inverse.
  await tx.step(
    "label-add",
    () => Promise.resolve(),
    () => makeCompensation("restore-labels-remove", executionLog),
  );
  assertEquals(
    tx.pendingCount(),
    1,
    "T3 success must leave exactly one compensation on the stack",
  );

  // T4 (label-remove) fails; caller is expected to rollback.
  const t4Error = new Error("T4 label-remove failed");
  await assertRejects(
    () => tx.step("label-remove", () => Promise.reject(t4Error)),
    Error,
    "T4 label-remove failed",
  );

  const report = await tx.rollback(t4Error);
  assertEquals(
    executionLog.length,
    expectedOrder.length,
    "exactly the recorded compensation must be attempted",
  );
  assertEquals(executionLog, expectedOrder);
  assertEquals(report.attempted, expectedOrder.length);
  assertEquals(report.succeeded, expectedOrder.length);
  assertEquals(report.partial, false);
  assertEquals(tx.pendingCount(), 0, "stack must be drained after rollback");
});

// ---------------------------------------------------------------------------
// §4.4 test case 3 — T5 fail: T3 + T4 compensations run in LIFO order
// ---------------------------------------------------------------------------

Deno.test("T5 fail: T4 then T3 compensations execute in LIFO order", async () => {
  const tx = new TransactionScope();
  const executionLog: string[] = [];
  // LIFO: the compensation registered last (T4) runs first.
  const expectedOrder = ["restore-labels-add", "restore-labels-remove"];

  await tx.step(
    "label-add",
    () => Promise.resolve(),
    () => makeCompensation("restore-labels-remove", executionLog),
  );
  await tx.step(
    "label-remove",
    () => Promise.resolve(),
    () => makeCompensation("restore-labels-add", executionLog),
  );
  assertEquals(tx.pendingCount(), 2, "two compensations must be recorded");

  const t5Error = new Error("T5 comment failed");
  await assertRejects(
    () => tx.step("handoff-comment", () => Promise.reject(t5Error)),
    Error,
    "T5 comment failed",
  );

  const report = await tx.rollback(t5Error);
  assertEquals(
    executionLog.length,
    expectedOrder.length,
    "every recorded compensation must be attempted",
  );
  assertEquals(
    executionLog,
    expectedOrder,
    "LIFO order must be reverse of registration",
  );
  assertEquals(report.attempted, expectedOrder.length);
  assertEquals(report.succeeded, expectedOrder.length);
  assertEquals(report.partial, false);
});

// ---------------------------------------------------------------------------
// §4.4 test case 4 — T6 fail: three compensations (including comment) run LIFO
// ---------------------------------------------------------------------------

Deno.test("T6 fail: three compensations run in LIFO including compensation comment", async () => {
  const tx = new TransactionScope();
  const executionLog: string[] = [];
  // Registration order: T3-inverse, T4-inverse, T5-inverse (comment).
  // Expected rollback order is the reverse.
  const registrationOrder = [
    "restore-labels-remove", // T3 inverse
    "restore-labels-add", // T4 inverse
    "compensation-comment", // T5 inverse
  ];
  const expectedOrder = [...registrationOrder].reverse();

  await tx.step(
    "label-add",
    () => Promise.resolve(),
    () => makeCompensation(registrationOrder[0], executionLog),
  );
  await tx.step(
    "label-remove",
    () => Promise.resolve(),
    () => makeCompensation(registrationOrder[1], executionLog),
  );
  await tx.step(
    "handoff-comment",
    () => Promise.resolve(),
    () => makeCompensation(registrationOrder[2], executionLog),
  );
  assertEquals(
    tx.pendingCount(),
    registrationOrder.length,
    "all three compensations must be recorded before T6",
  );

  const t6Error = new Error("T6 close failed");
  await assertRejects(
    () => tx.step("close-issue", () => Promise.reject(t6Error)),
    Error,
    "T6 close failed",
  );

  const report = await tx.rollback(t6Error);
  assertEquals(
    executionLog.length,
    expectedOrder.length,
    "non-vacuity: every compensation must be attempted",
  );
  assertEquals(executionLog, expectedOrder);
  assertEquals(report.attempted, expectedOrder.length);
  assertEquals(report.succeeded, expectedOrder.length);
  assertEquals(report.partial, false);
});

// ---------------------------------------------------------------------------
// §4.4 test case 5 — rollback idempotency
// ---------------------------------------------------------------------------

Deno.test("rollback idempotency: second rollback is a no-op", async () => {
  const tx = new TransactionScope();
  const executionLog: string[] = [];
  const expectedFirstRun = ["restore-labels-add", "restore-labels-remove"];

  await tx.step(
    "label-add",
    () => Promise.resolve(),
    () => makeCompensation("restore-labels-remove", executionLog),
  );
  await tx.step(
    "label-remove",
    () => Promise.resolve(),
    () => makeCompensation("restore-labels-add", executionLog),
  );

  const cause = new Error("some failure");
  const first = await tx.rollback(cause);
  assertEquals(first.attempted, expectedFirstRun.length);
  assertEquals(executionLog, expectedFirstRun);
  assertEquals(tx.isRolledBack(), true);
  assertEquals(tx.pendingCount(), 0);

  const second = await tx.rollback(cause);
  assertEquals(
    second.attempted,
    0,
    "rollback after rolledBack must attempt nothing",
  );
  assertEquals(second.succeeded, 0);
  assertEquals(second.failed.length, 0);
  assertEquals(second.partial, false);
  assertEquals(
    executionLog,
    expectedFirstRun,
    "execution log must not grow on the second rollback",
  );
});

// ---------------------------------------------------------------------------
// §4.4 test case 6 — compensation itself fails
// ---------------------------------------------------------------------------

Deno.test("compensation failure: other compensations still run and report.partial=true", async () => {
  const logger = newRecordingLogger();
  const tx = new TransactionScope({ logger });
  const executionLog: string[] = [];

  const failingLabel = "restore-labels-add";
  const survivingLabel = "restore-labels-remove";
  const compensationError = new Error("gh remove-label network error");

  // Registration order: surviving (T3), failing (T4).
  // LIFO rollback: failing runs first, then surviving.
  await tx.step(
    "label-add",
    () => Promise.resolve(),
    () => makeCompensation(survivingLabel, executionLog),
  );
  await tx.step(
    "label-remove",
    () => Promise.resolve(),
    () =>
      makeCompensation(failingLabel, executionLog, {
        throwOnRun: compensationError,
      }),
  );

  const cause = new Error("T5 failed");
  const report: CompensationReport = await tx.rollback(cause);

  assertEquals(
    executionLog,
    [failingLabel, survivingLabel],
    "both compensations must run in LIFO despite the first throwing",
  );
  assertEquals(report.attempted, 2);
  assertEquals(report.succeeded, 1);
  assertEquals(report.failed.length, 1);
  assertEquals(report.failed[0].label, failingLabel);
  assertEquals(report.failed[0].idempotencyKey, `key:${failingLabel}`);
  assertEquals(report.failed[0].error, compensationError);
  assertEquals(
    report.partial,
    true,
    "succeeded < attempted ⇒ partial must be true",
  );

  // Logger contract: warn is invoked exactly once — for the failing compensation.
  assertEquals(
    logger.calls.length,
    1,
    "TransactionLogger.warn must be called for each compensation failure",
  );
  const call = logger.calls[0];
  assertEquals(
    call.metadata?.event,
    "compensation_failed",
    "warn metadata must tag event=compensation_failed",
  );
  assertEquals(call.metadata?.label, failingLabel);
  assertEquals(call.metadata?.idempotencyKey, `key:${failingLabel}`);
  assertEquals(call.metadata?.error, compensationError.message);
  assertEquals(
    call.metadata?.cause,
    cause.message,
    "cause message must be propagated into warn metadata",
  );
});

// ---------------------------------------------------------------------------
// Additional contract tests
// ---------------------------------------------------------------------------

Deno.test("post-commit record() is a silent no-op", async () => {
  const tx = new TransactionScope();
  const executionLog: string[] = [];

  await tx.step(
    "label-add",
    () => Promise.resolve(),
    () => makeCompensation("restore-labels-remove", executionLog),
  );
  await tx.commit();
  assertEquals(tx.isCommitted(), true);
  assertEquals(
    tx.pendingCount(),
    0,
    "commit must clear the compensation stack",
  );

  // Contract: record() after commit returns without throwing and is a no-op.
  tx.record(makeCompensation("late-registration", executionLog));
  assertEquals(
    tx.pendingCount(),
    0,
    "record() after commit must not grow the stack",
  );
  assertEquals(
    executionLog.length,
    0,
    "no compensation should ever have run",
  );
});

Deno.test("post-commit rollback() returns an empty report and never throws", async () => {
  const tx = new TransactionScope();
  const executionLog: string[] = [];

  await tx.step(
    "label-add",
    () => Promise.resolve(),
    () => makeCompensation("restore-labels-remove", executionLog),
  );
  await tx.commit();

  const report = await tx.rollback(new Error("ignored after commit"));
  assertEquals(report.attempted, 0);
  assertEquals(report.succeeded, 0);
  assertEquals(report.failed.length, 0);
  assertEquals(report.partial, false);
  assertEquals(
    executionLog.length,
    0,
    "commit must prevent any compensation from running on later rollback",
  );
  assertEquals(
    tx.isCommitted(),
    true,
    "state must remain committed — rollback must not override it",
  );
  assertEquals(tx.isRolledBack(), false);
});

Deno.test("step() throws if called after commit", async () => {
  const tx = new TransactionScope();
  await tx.commit();
  await assertRejects(
    () => tx.step("late-step", () => Promise.resolve()),
    Error,
    "called after committed",
  );
});

Deno.test("step() throws if called after rollback", async () => {
  const tx = new TransactionScope();
  await tx.rollback(new Error("boom"));
  await assertRejects(
    () => tx.step("late-step", () => Promise.resolve()),
    Error,
    "called after rolledBack",
  );
});

Deno.test("action failure does not invoke compensationFactory", async () => {
  const tx = new TransactionScope();
  let factoryInvocations = 0;

  await assertRejects(
    () =>
      tx.step(
        "label-add",
        () => Promise.reject(new Error("action boom")),
        () => {
          factoryInvocations += 1;
          return {
            label: "should-not-exist",
            idempotencyKey: "never",
            run: () => Promise.resolve(),
          };
        },
      ),
    Error,
    "action boom",
  );

  assertEquals(
    factoryInvocations,
    0,
    "compensationFactory must only be called after action resolves",
  );
  assertEquals(
    tx.pendingCount(),
    0,
    "stack must be empty after a failed action",
  );
});

Deno.test("LIFO order is preserved for four sequential compensations", async () => {
  const tx = new TransactionScope();
  const executionLog: string[] = [];
  const registrationOrder = ["step-A", "step-B", "step-C", "step-D"];
  const expectedOrder = [...registrationOrder].reverse();

  for (const label of registrationOrder) {
    await tx.step(
      `action-${label}`,
      () => Promise.resolve(),
      () => makeCompensation(label, executionLog),
    );
  }
  assertEquals(
    tx.pendingCount(),
    registrationOrder.length,
    "stack size must equal registration count",
  );

  const report = await tx.rollback(new Error("cause"));
  assertEquals(
    executionLog.length,
    registrationOrder.length,
    "non-vacuity: every compensation must run",
  );
  assertEquals(executionLog, expectedOrder);
  assertEquals(report.attempted, registrationOrder.length);
  assertEquals(report.succeeded, registrationOrder.length);
  assertEquals(report.partial, false);
});

Deno.test("record() before any step also participates in LIFO rollback", async () => {
  const tx = new TransactionScope();
  const executionLog: string[] = [];

  // Directly record a compensation (e.g. a precomputed snapshot restorer).
  tx.record(makeCompensation("snapshot-restore", executionLog));
  await tx.step(
    "label-add",
    () => Promise.resolve(),
    () => makeCompensation("restore-labels-remove", executionLog),
  );
  assertEquals(tx.pendingCount(), 2);

  const expectedOrder = ["restore-labels-remove", "snapshot-restore"];
  const report = await tx.rollback(new Error("cause"));
  assertEquals(
    executionLog,
    expectedOrder,
    "record()-pushed compensation must roll back after later step()-pushed ones",
  );
  assertEquals(report.attempted, expectedOrder.length);
  assertEquals(report.succeeded, expectedOrder.length);
});

Deno.test("logger throwing does not break rollback", async () => {
  const brokenLogger: TransactionLogger = {
    warn: () => Promise.reject(new Error("logger sink is down")),
  };
  const tx = new TransactionScope({ logger: brokenLogger });
  const executionLog: string[] = [];
  const compensationError = new Error("compensation boom");

  await tx.step(
    "label-add",
    () => Promise.resolve(),
    () =>
      makeCompensation("restore-labels-remove", executionLog, {
        throwOnRun: compensationError,
      }),
  );

  // Must not throw despite both compensation AND logger failing.
  const report = await tx.rollback(new Error("cause"));
  assertEquals(report.attempted, 1);
  assertEquals(report.succeeded, 0);
  assertEquals(report.failed.length, 1);
  assertEquals(report.failed[0].error, compensationError);
  assertEquals(report.partial, true);
});

Deno.test("commit() is idempotent", async () => {
  const tx = new TransactionScope();
  await tx.step("label-add", () => Promise.resolve());
  await tx.commit();
  // Second commit must be a silent no-op.
  await tx.commit();
  assertEquals(tx.isCommitted(), true);
  assertEquals(tx.isRolledBack(), false);
});

Deno.test("CompensationFailure preserves non-Error throws as Error instances", async () => {
  const tx = new TransactionScope({ logger: newRecordingLogger() });
  const executionLog: string[] = [];
  const thrownValue = "string-shaped failure";

  // Inject a compensation that rejects with a non-Error value.
  tx.record({
    label: "odd-compensation",
    idempotencyKey: "key:odd",
    run: () => {
      executionLog.push("odd-compensation");
      return Promise.reject(thrownValue);
    },
  });

  const report = await tx.rollback(new Error("cause"));
  assertEquals(executionLog, ["odd-compensation"]);
  assertEquals(report.failed.length, 1);
  assertEquals(
    report.failed[0].error instanceof Error,
    true,
    "non-Error rejections must be normalized to Error before surfacing",
  );
  assertEquals(report.failed[0].error.message, thrownValue);
});
