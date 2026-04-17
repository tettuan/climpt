/**
 * TransactionScope: saga-style compensation registry for phase-transition
 * side-effects (label add/remove, handoff comment, issue close).
 *
 * Usage pattern:
 *   const tx = new TransactionScope({ logger });
 *   try {
 *     await tx.step("label-add", () => gh.addLabels(...), () => ({
 *       label: "restore-labels-add",
 *       idempotencyKey: `issue-${n}:labels-add:${cycleSeq}`,
 *       run: () => gh.removeLabels(...),
 *     }));
 *     await tx.step("label-remove", ...);
 *     await tx.commit();
 *   } catch (cause) {
 *     const report = await tx.rollback(cause);
 *     // surface report.partial / report.failed to caller for logging
 *   }
 *
 * Design contract (see tmp/transaction-rollback/investigation/design.md §4.3):
 *   - LIFO compensation order (reverse of registration).
 *   - Compensations are only recorded on step success.
 *   - rollback() is best-effort: each compensation failure is captured in
 *     CompensationReport.failed; the method itself never throws.
 *   - commit() clears the stack; post-commit record()/rollback() are no-ops.
 *   - Retry logic lives inside each Compensation.run, not in this class.
 *   - idempotencyKey is opaque metadata for the caller (e.g. to embed a
 *     deterministic marker in a compensation comment); this class only
 *     stores it so logs/reports can correlate.
 */

export interface Compensation {
  readonly label: string;
  readonly idempotencyKey: string;
  readonly run: () => Promise<void>;
}

export interface CompensationFailure {
  readonly label: string;
  readonly idempotencyKey: string;
  readonly error: Error;
}

export interface CompensationReport {
  readonly attempted: number;
  readonly succeeded: number;
  readonly failed: ReadonlyArray<CompensationFailure>;
  readonly partial: boolean;
}

export interface TransactionLogger {
  warn(message: string, metadata?: Record<string, unknown>): Promise<void>;
}

export interface TransactionScopeOptions {
  logger?: TransactionLogger;
}

type State = "open" | "committed" | "rolledBack";

export class TransactionScope {
  readonly #stack: Compensation[] = [];
  readonly #logger: TransactionLogger;
  #state: State = "open";

  constructor(options: TransactionScopeOptions = {}) {
    this.#logger = options.logger ?? consoleWarnLogger;
  }

  /** Push a compensation onto the LIFO stack. No-op once committed or rolled back. */
  record(compensation: Compensation): void {
    if (this.#state !== "open") return;
    this.#stack.push(compensation);
  }

  /**
   * Execute `action`; on success, register the compensation returned by
   * `compensationFactory` (if provided). On failure, rethrow without
   * registering — the caller is expected to invoke `rollback()`.
   *
   * `compensationFactory` is only invoked after `action` resolves, so it
   * can safely reference post-action state.
   */
  async step(
    label: string,
    action: () => Promise<void>,
    compensationFactory?: () => Compensation,
  ): Promise<void> {
    if (this.#state !== "open") {
      throw new Error(
        `TransactionScope.step("${label}") called after ${this.#state}`,
      );
    }
    await action();
    if (compensationFactory) {
      this.#stack.push(compensationFactory());
    }
  }

  /** Discard compensations; transition to committed. Idempotent. */
  commit(): Promise<void> {
    if (this.#state === "open") {
      this.#stack.length = 0;
      this.#state = "committed";
    }
    return Promise.resolve();
  }

  /**
   * Execute all recorded compensations in LIFO order. Each compensation is
   * best-effort: exceptions are caught and collected into the returned
   * report. The method itself never throws.
   *
   * No-op once committed or already rolled back — returns an empty report.
   */
  async rollback(cause: unknown): Promise<CompensationReport> {
    if (this.#state !== "open") {
      return emptyReport();
    }
    this.#state = "rolledBack";

    const pending = this.#stack.splice(0, this.#stack.length).reverse();
    const failed: CompensationFailure[] = [];
    let succeeded = 0;

    for (const compensation of pending) {
      try {
        // Saga compensations must run in strict LIFO order; later
        // compensations may depend on the side effects of earlier ones
        // being already reverted. Parallel execution would break that
        // ordering contract.
        // deno-lint-ignore no-await-in-loop
        await compensation.run();
        succeeded += 1;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        failed.push({
          label: compensation.label,
          idempotencyKey: compensation.idempotencyKey,
          error: err,
        });
        try {
          // Same LIFO-ordering rationale: log entry for a failed
          // compensation must be flushed before the next compensation
          // runs so operators see the sequence in correct order.
          // deno-lint-ignore no-await-in-loop
          await this.#logger.warn(
            `TransactionScope compensation "${compensation.label}" failed: ${err.message}`,
            {
              event: "compensation_failed",
              label: compensation.label,
              idempotencyKey: compensation.idempotencyKey,
              error: err.message,
              cause: causeMessage(cause),
            },
          );
        } catch {
          // logger itself must not break rollback
        }
      }
    }

    return {
      attempted: pending.length,
      succeeded,
      failed,
      partial: succeeded < pending.length,
    };
  }

  isCommitted(): boolean {
    return this.#state === "committed";
  }

  isRolledBack(): boolean {
    return this.#state === "rolledBack";
  }

  /** Number of compensations currently queued. Exposed for diagnostics only. */
  pendingCount(): number {
    return this.#stack.length;
  }
}

function emptyReport(): CompensationReport {
  return { attempted: 0, succeeded: 0, failed: [], partial: false };
}

function causeMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (cause === undefined) return "";
  return String(cause);
}

const consoleWarnLogger: TransactionLogger = {
  warn(message: string, metadata?: Record<string, unknown>): Promise<void> {
    // deno-lint-ignore no-console
    console.warn(`[transaction-scope] ${message}`, metadata ?? {});
    return Promise.resolve();
  },
};
