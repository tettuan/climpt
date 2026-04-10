/**
 * Tests for hasValidationChainSupport type guard.
 *
 * Covers Group 2 (G6): Chain instantiation decisions based on registry shape.
 *
 * Source of truth: agents/common/validation-types.ts hasValidationChainSupport()
 */

import { assertEquals } from "@std/assert";
import { hasValidationChainSupport } from "./validation-types.ts";

Deno.test("hasValidationChainSupport", async (t) => {
  await t.step("returns true when only validationSteps is present", () => {
    // Source of truth: hasValidationChainSupport function
    // Contract: validationSteps alone is sufficient
    const registry = { validationSteps: { "closure.test": {} } };
    assertEquals(
      hasValidationChainSupport(registry),
      true,
      "hasValidationChainSupport must return true when only validationSteps is defined. " +
        "Fix: agents/common/validation-types.ts hasValidationChainSupport()",
    );
  });

  await t.step("returns true when failurePatterns is present", () => {
    // Existing behavior preserved
    const registry = { failurePatterns: { "git-dirty": {} } };
    assertEquals(
      hasValidationChainSupport(registry),
      true,
      "hasValidationChainSupport must return true when failurePatterns is defined. " +
        "Fix: agents/common/validation-types.ts hasValidationChainSupport()",
    );
  });

  await t.step("returns true when validators is present", () => {
    // Existing behavior preserved
    const registry = { validators: { "git-clean": {} } };
    assertEquals(
      hasValidationChainSupport(registry),
      true,
      "hasValidationChainSupport must return true when validators is defined. " +
        "Fix: agents/common/validation-types.ts hasValidationChainSupport()",
    );
  });

  await t.step("returns true when all three keys are present", () => {
    // Combination: all keys present
    const registry = {
      failurePatterns: { "git-dirty": {} },
      validators: { "git-clean": {} },
      validationSteps: { "closure.test": {} },
    };
    assertEquals(
      hasValidationChainSupport(registry),
      true,
      "hasValidationChainSupport must return true when all validation keys are defined. " +
        "Fix: agents/common/validation-types.ts hasValidationChainSupport()",
    );
  });

  await t.step("returns false when none of the keys are present", () => {
    const registry = { steps: {} };
    assertEquals(
      hasValidationChainSupport(registry),
      false,
      "hasValidationChainSupport must return false when no validation keys are defined. " +
        "Fix: agents/common/validation-types.ts hasValidationChainSupport()",
    );
  });

  await t.step("returns false for null", () => {
    assertEquals(
      hasValidationChainSupport(null),
      false,
      "hasValidationChainSupport must return false for null input. " +
        "Fix: agents/common/validation-types.ts hasValidationChainSupport()",
    );
  });

  await t.step("returns false for undefined", () => {
    assertEquals(
      hasValidationChainSupport(undefined),
      false,
      "hasValidationChainSupport must return false for undefined input. " +
        "Fix: agents/common/validation-types.ts hasValidationChainSupport()",
    );
  });

  await t.step("returns false for non-object (string)", () => {
    assertEquals(
      hasValidationChainSupport("string"),
      false,
      "hasValidationChainSupport must return false for string input. " +
        "Fix: agents/common/validation-types.ts hasValidationChainSupport()",
    );
  });

  await t.step("returns false for non-object (number)", () => {
    assertEquals(
      hasValidationChainSupport(42),
      false,
      "hasValidationChainSupport must return false for number input. " +
        "Fix: agents/common/validation-types.ts hasValidationChainSupport()",
    );
  });
});
