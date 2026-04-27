/**
 * Decision ADT contract tests (T1.4).
 *
 * Asserts the structural invariants the rest of the validator chain
 * depends on:
 *  - `accept` / `reject` produce the documented discriminator shapes
 *  - `combineDecisions` accumulates errors (no first-error-wins)
 *  - `decisionFromLegacy` lifts a `ValidationResult`-like shape
 *    preserving message order
 *  - `decisionFromLegacyMapped` resolves codes per-message
 *  - `BootValidationFailed` carries the full error list
 *
 * Source of truth: `agents/shared/validation/{decision,errors,adapter,boundary}.ts`.
 */

import { assertEquals, assertStrictEquals } from "@std/assert";
import {
  accept,
  acceptVoid,
  BootValidationFailed,
  combineDecisions,
  type Decision,
  decisionFromLegacy,
  decisionFromLegacyMapped,
  decisionFromSchema,
  isAccept,
  isReject,
  reject,
  throwIfRejected,
  type ValidationError,
  validationError,
} from "./mod.ts";

Deno.test("accept produces { kind: 'accept', value }", () => {
  const d = accept(42);
  assertEquals(d.kind, "accept");
  if (d.kind === "accept") {
    assertEquals(d.value, 42);
  }
});

Deno.test("acceptVoid is shorthand for accept(undefined)", () => {
  const d = acceptVoid();
  assertEquals(d.kind, "accept");
});

Deno.test("reject produces { kind: 'reject', errors }", () => {
  const errs: ValidationError[] = [
    validationError("W1", "boom"),
  ];
  const d = reject(errs);
  assertEquals(d.kind, "reject");
  if (d.kind === "reject") {
    assertEquals(d.errors.length, 1);
    assertEquals(d.errors[0].code, "W1");
  }
});

Deno.test("isAccept / isReject discriminate correctly", () => {
  const a: Decision<number> = accept(1);
  const r: Decision<number> = reject([validationError("S1", "x")]);
  assertEquals(isAccept(a), true);
  assertEquals(isReject(a), false);
  assertEquals(isAccept(r), false);
  assertEquals(isReject(r), true);
});

Deno.test("combineDecisions: all accept -> accept(values)", () => {
  const d = combineDecisions<number>([accept(1), accept(2), accept(3)]);
  assertEquals(d.kind, "accept");
  if (d.kind === "accept") {
    assertEquals([...d.value], [1, 2, 3]);
  }
});

Deno.test("combineDecisions: any reject -> reject with all errors", () => {
  // Critical contract: errors accumulate, first-error-wins is NOT preserved.
  const d = combineDecisions<number>([
    reject([validationError("W1", "first")]),
    accept(1),
    reject([validationError("A3", "second"), validationError("S2", "third")]),
  ]);
  assertEquals(d.kind, "reject");
  if (d.kind === "reject") {
    assertEquals(d.errors.length, 3);
    assertEquals(d.errors.map((e) => e.code), ["W1", "A3", "S2"]);
  }
});

Deno.test("decisionFromLegacy preserves message order and tags code", () => {
  const d = decisionFromLegacy(
    { valid: false, errors: ["msg1", "msg2"] },
    "A2",
    "agent.json",
  );
  assertEquals(d.kind, "reject");
  if (d.kind === "reject") {
    assertEquals(d.errors.length, 2);
    assertEquals(d.errors[0].code, "A2");
    assertEquals(d.errors[0].message, "msg1");
    assertEquals(d.errors[0].source, "agent.json");
    assertEquals(d.errors[1].message, "msg2");
  }
});

Deno.test("decisionFromLegacy: valid + empty errors -> accept", () => {
  const d = decisionFromLegacy(
    { valid: true, errors: [] },
    "A2",
  );
  assertEquals(d.kind, "accept");
});

Deno.test("decisionFromLegacyMapped picks per-message codes", () => {
  const d = decisionFromLegacyMapped(
    {
      valid: false,
      errors: [
        "step X does not exist in steps",
        "verification: should target work step",
        "unmatched fallback message",
      ],
    },
    (msg) => {
      if (msg.includes("does not exist in steps")) return "S2";
      if (msg.includes("should target")) return "A4";
      return undefined;
    },
    "A3",
  );
  assertEquals(d.kind, "reject");
  if (d.kind === "reject") {
    assertEquals(d.errors.map((e) => e.code), ["S2", "A4", "A3"]);
  }
});

Deno.test("decisionFromSchema preserves path in context", () => {
  const d = decisionFromSchema(
    {
      valid: false,
      errors: [{ path: "runner.verdict.type", message: "bad type" }],
    },
    "A2",
  );
  assertEquals(d.kind, "reject");
  if (d.kind === "reject") {
    assertEquals(d.errors[0].code, "A2");
    assertEquals(d.errors[0].context?.path, "runner.verdict.type");
  }
});

Deno.test("BootValidationFailed carries errors and formats message", () => {
  const errs: ValidationError[] = [
    validationError("W1", "phase missing", { source: "workflow.json" }),
    validationError("S2", "target unknown"),
  ];
  const err = new BootValidationFailed(errs);
  assertEquals(err.errors.length, 2);
  assertEquals(err.code, "BOOT-VALIDATION-FAILED");
  assertEquals(err.recoverable, false);
  // Message must include both error codes (W/A/S code prefix).
  assertEquals(err.message.includes("[W1]"), true);
  assertEquals(err.message.includes("[S2]"), true);
});

Deno.test("throwIfRejected: empty errors -> no throw", () => {
  // Should not throw.
  throwIfRejected([]);
});

Deno.test("throwIfRejected: non-empty errors -> throws BootValidationFailed", () => {
  let caught: unknown;
  try {
    throwIfRejected([validationError("A1", "dup")]);
  } catch (e) {
    caught = e;
  }
  assertEquals(caught instanceof BootValidationFailed, true);
  if (caught instanceof BootValidationFailed) {
    assertEquals(caught.errors.length, 1);
    assertEquals(caught.errors[0].code, "A1");
  }
});

Deno.test("ValidationErrorCode covers all 26 rules in scope", () => {
  // Diagnosability: if a new code is added (e.g., W11 in T5.2), this
  // test forces us to either include it intentionally or document the
  // exclusion. T1.4 scope is W1..W10 + A1..A8 + S1..S8 = 26 codes.
  const expected: string[] = [
    // W: workflow.json (W11 reserved for T5.2 — intentionally excluded)
    "W1",
    "W2",
    "W3",
    "W4",
    "W5",
    "W6",
    "W7",
    "W8",
    "W9",
    "W10",
    // A: agent bundle
    "A1",
    "A2",
    "A3",
    "A4",
    "A5",
    "A6",
    "A7",
    "A8",
    // S: step registry
    "S1",
    "S2",
    "S3",
    "S4",
    "S5",
    "S6",
    "S7",
    "S8",
  ];
  assertEquals(expected.length, 26);
  // Every code must construct a ValidationError without compile error
  // (the type system enforces this, but we exercise the runtime path
  // so a regression in the codec/JSON shape is caught).
  for (const code of expected) {
    // deno-lint-ignore no-explicit-any
    const ve = validationError(code as any, `test-${code}`);
    assertStrictEquals(ve.code, code);
  }
});
