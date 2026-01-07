/**
 * Merge Utility Tests
 */

import { assertEquals } from "@std/assert";
import { ITERATOR_MERGE_ORDER, REVIEWER_MERGE_ORDER } from "./merge.ts";

Deno.test("ITERATOR_MERGE_ORDER - squash is first priority", () => {
  assertEquals(ITERATOR_MERGE_ORDER[0], "squash");
  assertEquals(ITERATOR_MERGE_ORDER[1], "fast-forward");
  assertEquals(ITERATOR_MERGE_ORDER[2], "merge-commit");
});

Deno.test("REVIEWER_MERGE_ORDER - fast-forward is first priority", () => {
  assertEquals(REVIEWER_MERGE_ORDER[0], "fast-forward");
  assertEquals(REVIEWER_MERGE_ORDER[1], "squash");
  assertEquals(REVIEWER_MERGE_ORDER[2], "merge-commit");
});

Deno.test("ITERATOR_MERGE_ORDER - has 3 strategies", () => {
  assertEquals(ITERATOR_MERGE_ORDER.length, 3);
});

Deno.test("REVIEWER_MERGE_ORDER - has 3 strategies", () => {
  assertEquals(REVIEWER_MERGE_ORDER.length, 3);
});
