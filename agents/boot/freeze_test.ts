/**
 * Unit tests for {@link deepFreeze}.
 *
 * Validates the P2 mitigation invariant: every nested node in a
 * BootArtifacts-shaped tree is `Object.isFrozen` after a single call.
 * Primitives, already-frozen nodes, and cyclic graphs are handled.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { deepFreeze } from "./freeze.ts";

Deno.test("deepFreeze freezes the top-level object", () => {
  const obj = { a: 1 };
  deepFreeze(obj);
  assert(Object.isFrozen(obj), "top-level object must be frozen");
});

Deno.test("deepFreeze freezes nested objects", () => {
  const obj = {
    workflow: { version: "1.0.0", phases: { ready: { type: "actionable" } } },
  };
  deepFreeze(obj);
  assert(Object.isFrozen(obj));
  assert(Object.isFrozen(obj.workflow), "obj.workflow must be frozen");
  assert(Object.isFrozen(obj.workflow.phases), "phases must be frozen");
  assert(
    Object.isFrozen(obj.workflow.phases.ready),
    "ready phase must be frozen",
  );
});

Deno.test("deepFreeze freezes arrays and their elements", () => {
  const obj = { agents: [{ id: "a" }, { id: "b" }] };
  deepFreeze(obj);
  assert(Object.isFrozen(obj.agents), "array must be frozen");
  assert(Object.isFrozen(obj.agents[0]), "array element 0 must be frozen");
  assert(Object.isFrozen(obj.agents[1]), "array element 1 must be frozen");
});

Deno.test("deepFreeze leaves primitives untouched", () => {
  assertEquals(deepFreeze(42), 42);
  assertEquals(deepFreeze("hello"), "hello");
  assertEquals(deepFreeze(null), null);
  assertEquals(deepFreeze(undefined), undefined);
  assertEquals(deepFreeze(true), true);
});

Deno.test("deepFreeze prevents mutation of nested fields", () => {
  const obj: { workflow: { rules: { maxCycles: number } } } = {
    workflow: { rules: { maxCycles: 5 } },
  };
  deepFreeze(obj);
  assertThrows(
    () => {
      // Strict mode: assignment to frozen target throws.
      obj.workflow.rules.maxCycles = 99;
    },
    TypeError,
  );
});

Deno.test("deepFreeze is idempotent on already-frozen subtree", () => {
  const inner = Object.freeze({ x: 1 });
  const outer = { inner };
  // Should not throw and should still freeze the outer.
  deepFreeze(outer);
  assert(Object.isFrozen(outer));
  assert(Object.isFrozen(outer.inner));
});

Deno.test("deepFreeze handles cyclic references", () => {
  type Node = { name: string; self?: Node };
  const node: Node = { name: "root" };
  node.self = node;
  // Should terminate (already-frozen short-circuit).
  deepFreeze(node);
  assert(Object.isFrozen(node));
});
