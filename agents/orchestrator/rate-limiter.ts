/**
 * RateLimiter - Rate limit throttle logic extracted from Orchestrator
 *
 * Monitors API rate limit utilization and pauses execution
 * when utilization exceeds the configured threshold.
 */

import type { RateLimitInfo } from "../src_common/types/runtime.ts";
import type { OrchestratorLogger } from "./orchestrator-logger.ts";

export class RateLimiter {
  #threshold: number;
  #pollIntervalMs: number;

  constructor(threshold: number, pollIntervalMs: number) {
    this.#threshold = threshold;
    this.#pollIntervalMs = pollIntervalMs;
  }

  /** Returns true when utilization meets or exceeds the threshold. */
  shouldThrottle(rateLimitInfo: RateLimitInfo): boolean {
    return rateLimitInfo.utilization >= this.#threshold;
  }

  /** If utilization exceeds threshold, polls until the reset timestamp passes. */
  async checkAndThrottle(
    rateLimitInfo: RateLimitInfo,
    log: OrchestratorLogger,
  ): Promise<void> {
    if (!this.shouldThrottle(rateLimitInfo)) return;

    // Guard: reject invalid timestamps to prevent infinite loop
    if (
      !Number.isFinite(rateLimitInfo.resetsAt) || rateLimitInfo.resetsAt <= 0
    ) {
      await log.warn(
        `Rate limit throttle: invalid resetsAt (${rateLimitInfo.resetsAt}), skipping wait`,
        { event: "rate_limit_invalid_reset", resetsAt: rateLimitInfo.resetsAt },
      );
      return;
    }

    await log.warn(
      `Rate limit throttle: ${rateLimitInfo.rateLimitType} utilization ${rateLimitInfo.utilization} >= ${this.#threshold}, ` +
        `waiting until reset at ${
          new Date(rateLimitInfo.resetsAt * 1000).toISOString()
        }`,
      {
        event: "rate_limit_throttle_start",
        utilization: rateLimitInfo.utilization,
        resetsAt: rateLimitInfo.resetsAt,
        rateLimitType: rateLimitInfo.rateLimitType,
        threshold: this.#threshold,
      },
    );

    while (true) {
      const nowSec = Math.floor(Date.now() / 1000);
      const remainingSec = rateLimitInfo.resetsAt - nowSec;
      if (remainingSec <= 0) break;

      const waitMs = Math.min(remainingSec * 1000, this.#pollIntervalMs);
      // deno-lint-ignore no-await-in-loop
      await log.info(
        `Rate limit throttle: ${remainingSec}s remaining until reset`,
        {
          event: "rate_limit_wait",
          remainingSec,
          resetsAt: rateLimitInfo.resetsAt,
        },
      );
      // deno-lint-ignore no-await-in-loop
      await this.#delay(waitMs);
    }

    await log.info("Rate limit reset, resuming orchestrator", {
      event: "rate_limit_resumed",
    });
  }

  #delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
