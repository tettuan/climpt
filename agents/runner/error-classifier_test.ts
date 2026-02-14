/**
 * Tests for error-classifier.ts
 */

import { assertEquals, assertExists } from "@std/assert";
import {
  classifySdkError,
  isApiError,
  isEnvironmentError,
  isNetworkError,
  SdkErrorCategory,
} from "./error-classifier.ts";

Deno.test("error-classifier", async (t) => {
  await t.step("classifies double sandbox error", () => {
    const error = new Error("Claude Code process exited with code 1");
    const classified = classifySdkError(error);

    assertEquals(classified.category, SdkErrorCategory.ENVIRONMENT);
    assertEquals(classified.recoverable, false);
    assertExists(classified.guidance);
    assertExists(classified.matchedPattern);
  });

  await t.step("classifies permission denied error", () => {
    const error = new Error("EPERM: operation not permitted, open '/path'");
    const classified = classifySdkError(error);

    assertEquals(classified.category, SdkErrorCategory.ENVIRONMENT);
    assertEquals(classified.recoverable, false);
  });

  await t.step("classifies network errors as recoverable", () => {
    const errors = [
      new Error("ECONNREFUSED"),
      new Error("ETIMEDOUT"),
      new Error("socket hang up"),
    ];

    for (const error of errors) {
      const classified = classifySdkError(error);
      assertEquals(classified.category, SdkErrorCategory.NETWORK);
      assertEquals(classified.recoverable, true);
    }
  });

  await t.step("classifies rate limit error", () => {
    const error = new Error("429 Too Many Requests");
    const classified = classifySdkError(error);

    assertEquals(classified.category, SdkErrorCategory.API);
    assertEquals(classified.recoverable, true);
  });

  await t.step("classifies authentication error as not recoverable", () => {
    const error = new Error("401 Unauthorized");
    const classified = classifySdkError(error);

    assertEquals(classified.category, SdkErrorCategory.API);
    assertEquals(classified.recoverable, false);
  });

  await t.step("classifies unknown error", () => {
    const error = new Error("Something completely unexpected");
    const classified = classifySdkError(error);

    assertEquals(classified.category, SdkErrorCategory.UNKNOWN);
    assertEquals(classified.recoverable, false);
    assertEquals(classified.matchedPattern, null);
  });

  await t.step("category helpers work correctly", () => {
    assertEquals(isEnvironmentError(SdkErrorCategory.ENVIRONMENT), true);
    assertEquals(isEnvironmentError(SdkErrorCategory.NETWORK), false);

    assertEquals(isNetworkError(SdkErrorCategory.NETWORK), true);
    assertEquals(isNetworkError(SdkErrorCategory.API), false);

    assertEquals(isApiError(SdkErrorCategory.API), true);
    assertEquals(isApiError(SdkErrorCategory.ENVIRONMENT), false);
  });
});
