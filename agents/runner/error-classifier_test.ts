/**
 * Tests for error-classifier.ts
 */

import { assertEquals, assertExists } from "@std/assert";
import { BreakdownLogger } from "@tettuan/breakdownlogger";
import {
  classifySdkError,
  isApiError,
  isEnvironmentError,
  isNetworkError,
  parseResetTime,
  SdkErrorCategory,
} from "./error-classifier.ts";

const logger = new BreakdownLogger("error");

Deno.test("error-classifier", async (t) => {
  await t.step("classifies double sandbox error", () => {
    const error = new Error("Claude Code process exited with code 1");
    const classified = classifySdkError(error);
    logger.debug("classified error", {
      message: error.message,
      category: classified.category,
      recoverable: classified.recoverable,
    });

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
      logger.debug("classifySdkError input", { message: error.message });
      const classified = classifySdkError(error);
      logger.debug("classifySdkError result", {
        category: classified.category,
        recoverable: classified.recoverable,
      });
      assertEquals(classified.category, SdkErrorCategory.NETWORK);
      assertEquals(classified.recoverable, true);
    }
  });

  await t.step("classifies rate limit error", () => {
    const error = new Error("429 Too Many Requests");
    logger.debug("classifySdkError input", { message: error.message });
    const classified = classifySdkError(error);
    logger.debug("classifySdkError result", {
      category: classified.category,
      recoverable: classified.recoverable,
    });

    assertEquals(classified.category, SdkErrorCategory.API);
    assertEquals(classified.recoverable, true);
  });

  await t.step("classifies authentication error as not recoverable", () => {
    const error = new Error("401 Unauthorized");
    logger.debug("classifySdkError input", { message: error.message });
    const classified = classifySdkError(error);
    logger.debug("classifySdkError result", {
      category: classified.category,
      recoverable: classified.recoverable,
    });

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

// JavaScript's Date constructor uses 0-based month indices, an off-by-one
// trap. Name the indices explicitly so the test code itself reads like the
// wallclock expectation it encodes.
const APRIL = 3;
const MAY = 4;

/**
 * Convert an expected wallclock Date into the seconds-since-epoch the
 * parser is contracted to return. Wraps the
 * `Math.floor(getTime() / 1000)` arithmetic in a single place and
 * builds a diagnostic message that includes both inputs and both sides
 * of the mismatch — so a failure points at the wallclock the parser
 * resolved instead of opaque integer seconds.
 */
function assertParsesTo(
  message: string,
  now: Date,
  expected: Date,
): void {
  const expectedSec = Math.floor(expected.getTime() / 1000);
  const got = parseResetTime(message, now);
  const gotIso = got !== null ? new Date(got * 1000).toISOString() : "null";
  assertEquals(
    got,
    expectedSec,
    `parseResetTime(${JSON.stringify(message)}, now=${now.toISOString()}) ` +
      `→ ${got} (${gotIso}); expected ${expectedSec} (${expected.toISOString()}). ` +
      `Fix: error-classifier.ts parseResetTime regex or am/pm/12-hour conversion.`,
  );
}

function assertParsesToNull(message: string, now: Date = new Date()): void {
  const got = parseResetTime(message, now);
  assertEquals(
    got,
    null,
    `parseResetTime(${JSON.stringify(message)}, now=${now.toISOString()}) ` +
      `→ ${got}; expected null. ` +
      `Fix: error-classifier.ts parseResetTime must reject this token shape.`,
  );
}

Deno.test("parseResetTime", async (t) => {
  // Anchor "now" inside each step so the relative calculation is deterministic.
  await t.step("parses '· resets 1am' to next 01:00 local", () => {
    const now = new Date(2026, APRIL, 30, 7, 37, 0); // Apr 30 07:37 local
    // Today's 01:00 has already passed → next 01:00 is tomorrow (May 1).
    const expected = new Date(2026, MAY, 1, 1, 0, 0);
    assertParsesTo("You've hit your limit · resets 1am", now, expected);
  });

  await t.step("parses '· resets 1pm' as 13:00", () => {
    const now = new Date(2026, APRIL, 30, 7, 37, 0);
    // 13:00 is still in the future today → same day.
    const expected = new Date(2026, APRIL, 30, 13, 0, 0);
    assertParsesTo("rate limit · resets 1pm", now, expected);
  });

  await t.step("parses '· resets 12am' as 00:00 next day", () => {
    const now = new Date(2026, APRIL, 30, 7, 37, 0);
    // 12am is midnight; today's midnight has passed → next is tomorrow 00:00.
    const expected = new Date(2026, MAY, 1, 0, 0, 0);
    assertParsesTo("· resets 12am", now, expected);
  });

  await t.step("parses '· resets 12pm' as noon today", () => {
    const now = new Date(2026, APRIL, 30, 7, 37, 0);
    // 12pm is noon, still in the future today.
    const expected = new Date(2026, APRIL, 30, 12, 0, 0);
    assertParsesTo("· resets 12pm", now, expected);
  });

  await t.step("rolls over to next day when target hour already passed", () => {
    const now = new Date(2026, APRIL, 30, 14, 0, 0); // 14:00
    // 13:00 has already passed today → next 13:00 is tomorrow.
    const expected = new Date(2026, MAY, 1, 13, 0, 0);
    assertParsesTo("resets 1pm", now, expected);
  });

  await t.step("parses minutes when present (resets 1:30am)", () => {
    const now = new Date(2026, APRIL, 30, 7, 37, 0);
    const expected = new Date(2026, MAY, 1, 1, 30, 0);
    assertParsesTo("resets 1:30am", now, expected);
  });

  await t.step("returns null when no resets-token is present", () => {
    assertParsesToNull("429 Too Many Requests");
    assertParsesToNull("");
  });

  await t.step("returns null on out-of-range hour or minute", () => {
    const now = new Date(2026, APRIL, 30, 7, 37, 0);
    assertParsesToNull("resets 13am", now); // hour > 12
    assertParsesToNull("resets 0am", now); // hour < 1
    assertParsesToNull("resets 1:60am", now); // minute = 60
  });
});
