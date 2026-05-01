/**
 * Policy ADT — Layer 4 environment / transport policy (design 20 §B).
 *
 * Per design 20 §B, `Policy` is one of the 5 frozen Layer-4 inputs.
 * It captures the **environment-level** preconditions (whether stores
 * are wired, which `gh` binary to invoke, whether the policy applies
 * to subprocesses) and the **transport polarity** (Real / File / Mock
 * for issue-query and close paths).
 *
 * Phase 2 scope (T2.1):
 * - Type and minimum-viable `loadPolicy` factory only. Defaults are
 *   returned when no opts are supplied, so all 3 invocation modes
 *   share a Boot path even before a `boot-policy.json` source exists.
 * - The `applyToSubprocess` flag is declared but **not yet observed**
 *   by `merge-pr.ts` — that wiring lands in T6.4 per phased-plan §6.
 *
 * Future scope (T6.4):
 * - Read from a `tmp/boot-policy-<runId>.json` written by the parent
 *   process; merge-pr's first action becomes "read + freeze the
 *   inherited Policy" so Layer 4 inheritance is structurally provable
 *   (design 20 §E).
 *
 * Design refs:
 *  - `agents/docs/design/realistic/10-system-overview.md` §B (Boot inputs)
 *  - `agents/docs/design/realistic/20-state-hierarchy.md`  §B / §E
 *  - `tmp/realistic-migration/phased-plan.md` §P2 / §P6 T6.4
 *
 * @module
 */

/**
 * Transport polarity (design 20 §B + 12 §C).
 *
 * Two seams are tracked separately so the P2 polarity rule (read-only
 * issue listing ≠ close-write transport) holds at the type level.
 *
 * - `issueQuery`: SubjectPicker / IssueSyncer reads issues via this seam.
 *   `real` shells `gh issue list`; `file` reads from a local SubjectStore;
 *   `mock` returns fixture data (test-only).
 * - `close`: Channel.execute writes back via this seam. Paired so that
 *   "real read + file write" = sandboxed dry-run mode (W10 valid pair).
 *
 * Pairs validated by W10 (12 §F + Phase 2 T2.2):
 *  - RR (real,  real)
 *  - RF (real,  file)
 *  - FF (file,  file)
 *  - MF (mock,  file)  — test fixture mode
 */
export interface TransportPolicy {
  readonly issueQuery: "real" | "file" | "mock";
  readonly close: "real" | "file" | "mock";
}

/**
 * Layer 4 Policy — environment / transport preconditions (design 20 §B).
 *
 * `readonly` end-to-end so {@link deepFreeze} at Boot completion makes
 * mutation impossible (Layer 4 Run-immutable).
 */
export interface Policy {
  /**
   * Whether persistent stores (SubjectStore / artifact registries) are
   * wired. `false` means the run is a dry-pass that should not touch
   * persistent state (transports may still do real reads).
   */
  readonly storeWired: boolean;

  /**
   * Path to the `gh` binary. `"gh"` means use `$PATH` discovery.
   * Explicit absolute paths are used in CI / hermetic environments.
   */
  readonly ghBinary: string;

  /**
   * Whether the parent process's Layer 4 should propagate to the
   * `merge-pr` subprocess. `true` is the design-default per 20 §E
   * (subprocess inheritance). T6.4 wires the actual write/read of the
   * `boot-policy-<runId>.json` artifact.
   */
  readonly applyToSubprocess: boolean;

  /**
   * Transport polarity (read vs close). See {@link TransportPolicy}.
   */
  readonly transports: TransportPolicy;
}

/**
 * Optional overrides accepted by {@link loadPolicy}.
 *
 * The minimal set needed in T2.1; T6.4 expands this to include a
 * `readFrom: string` path that points at a `boot-policy-<runId>.json`
 * file written by a parent process.
 */
export interface LoadPolicyOpts {
  readonly ghBinary?: string;
  readonly storeWired?: boolean;
  readonly applyToSubprocess?: boolean;
  readonly transports?: Partial<TransportPolicy>;
}

const DEFAULT_TRANSPORTS: TransportPolicy = {
  issueQuery: "real",
  close: "real",
};

/**
 * Construct a {@link Policy} from defaults plus optional overrides.
 *
 * Phase 2 (T2.1) returns a default Policy without reading any disk
 * config. Subsequent phases (T6.4) replace this with a loader that
 * reads `tmp/boot-policy-<runId>.json` when the parent process passed
 * one. The `cwd` parameter is accepted now for forward-compatibility
 * so call sites do not need to change in T6.4.
 *
 * The returned object is **not** pre-frozen; {@link deepFreeze} is
 * applied to the entire BootArtifacts tree at the end of
 * `BootKernel.boot` (single-freeze invariant per Critique F1).
 *
 * @param _cwd Repository root — unused in T2.1, reserved for T6.4.
 * @param opts Optional overrides.
 * @returns A fresh `Policy`.
 */
export function loadPolicy(
  _cwd: string,
  opts?: LoadPolicyOpts,
): Policy {
  return {
    storeWired: opts?.storeWired ?? true,
    ghBinary: opts?.ghBinary ?? "gh",
    applyToSubprocess: opts?.applyToSubprocess ?? true,
    transports: {
      issueQuery: opts?.transports?.issueQuery ?? DEFAULT_TRANSPORTS.issueQuery,
      close: opts?.transports?.close ?? DEFAULT_TRANSPORTS.close,
    },
  };
}

// -----------------------------------------------------------------------------
// T6.4 — Layer-4 inheritance via file-based IPC
// -----------------------------------------------------------------------------

/**
 * Versioned wire shape for `tmp/boot-policy-<runId>.json`. The version
 * tag is checked at read-time so a future format change can be rejected
 * with a precise error rather than crashing on a missing field.
 */
const BOOT_POLICY_FILE_VERSION = "1" as const;

interface BootPolicyFile {
  readonly version: typeof BOOT_POLICY_FILE_VERSION;
  readonly runId: string;
  readonly writtenAt: number;
  readonly policy: Policy;
}

/**
 * Compute the canonical policy-file path under `tmp/boot-policy-<runId>.json`
 * relative to `cwd`. Centralised so parent-write and subprocess-read
 * agree on a single source of truth.
 */
export function bootPolicyFilePath(cwd: string, runId: string): string {
  return `${cwd}/tmp/boot-policy-${runId}.json`;
}

/**
 * Parent-side helper: serialise `policy` to the canonical
 * `tmp/boot-policy-<runId>.json` file so a subsequently-spawned
 * `merge-pr` subprocess can inherit the same Layer 4 environment.
 *
 * Per design 20 §E / Critique F15, the parent must write before
 * spawning the subprocess; the subprocess's read is the inheritance
 * boundary. This helper guarantees the directory exists and writes
 * atomically (write-then-rename via `Deno.writeTextFile` — Deno
 * already does the safe-write for us).
 *
 * @throws Propagates filesystem errors so `BootKernel.boot` can surface
 *         them as a `BootValidationFailed` if the parent cannot honour
 *         `policy.applyToSubprocess === true`.
 */
export async function writeBootPolicyFile(
  policy: Policy,
  runId: string,
  cwd: string,
): Promise<string> {
  const path = bootPolicyFilePath(cwd, runId);
  const payload: BootPolicyFile = {
    version: BOOT_POLICY_FILE_VERSION,
    runId,
    writtenAt: Date.now(),
    policy,
  };
  await Deno.mkdir(`${cwd}/tmp`, { recursive: true });
  await Deno.writeTextFile(path, JSON.stringify(payload, null, 2));
  return path;
}

/**
 * Subprocess-side helper: read + validate a parent-written
 * `boot-policy-<runId>.json` and reconstitute the {@link Policy}.
 *
 * Validation surface:
 *  - file must exist (NotFound → caller-visible error so the broken
 *    inheritance is loud, not silent)
 *  - JSON must parse
 *  - `version` must equal {@link BOOT_POLICY_FILE_VERSION} (forward-
 *    compat: a future v2 file is rejected explicitly so the subprocess
 *    cannot consume a payload it doesn't understand)
 *  - structural fields must satisfy the {@link Policy} ADT
 *
 * The returned `Policy` is **not** pre-frozen; the merge-pr CLI freezes
 * via the same `deepFreeze` import so the inheritance boundary mirrors
 * `BootKernel.boot`'s freeze step (Layer-4 Run-immutable, design 20 §E).
 */
export async function readBootPolicyFile(path: string): Promise<Policy> {
  let raw: string;
  try {
    raw = await Deno.readTextFile(path);
  } catch (cause) {
    if (cause instanceof Deno.errors.NotFound) {
      throw new Error(
        `Layer-4 inheritance broken: boot-policy file not found at "${path}". ` +
          `The parent process must call writeBootPolicyFile() before spawning ` +
          `merge-pr when policy.applyToSubprocess === true (design 20 §E).`,
        { cause },
      );
    }
    throw new Error(
      `Layer-4 inheritance broken: cannot read boot-policy file "${path}": ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      { cause },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(
      `Layer-4 inheritance broken: boot-policy file "${path}" is not valid JSON: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      { cause },
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `Layer-4 inheritance broken: boot-policy file "${path}" root is not an object`,
    );
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.version !== BOOT_POLICY_FILE_VERSION) {
    throw new Error(
      `Layer-4 inheritance broken: boot-policy file "${path}" version ` +
        `"${String(obj.version)}" is not "${BOOT_POLICY_FILE_VERSION}". ` +
        `Parent and subprocess must agree on the wire format.`,
    );
  }
  const p = obj.policy;
  if (typeof p !== "object" || p === null || Array.isArray(p)) {
    throw new Error(
      `Layer-4 inheritance broken: boot-policy file "${path}" missing 'policy' object`,
    );
  }
  const pol = p as Record<string, unknown>;
  const transports = pol.transports;
  if (
    typeof transports !== "object" || transports === null ||
    Array.isArray(transports)
  ) {
    throw new Error(
      `Layer-4 inheritance broken: boot-policy file "${path}" missing 'policy.transports'`,
    );
  }
  const tr = transports as Record<string, unknown>;
  const issueQuery = tr.issueQuery;
  const close = tr.close;
  if (
    (issueQuery !== "real" && issueQuery !== "file" && issueQuery !== "mock") ||
    (close !== "real" && close !== "file" && close !== "mock")
  ) {
    throw new Error(
      `Layer-4 inheritance broken: boot-policy file "${path}" has invalid ` +
        `transports (issueQuery="${String(issueQuery)}", close="${
          String(close)
        }")`,
    );
  }
  if (
    typeof pol.storeWired !== "boolean" ||
    typeof pol.ghBinary !== "string" ||
    typeof pol.applyToSubprocess !== "boolean"
  ) {
    throw new Error(
      `Layer-4 inheritance broken: boot-policy file "${path}" missing required ` +
        `Policy fields (storeWired/ghBinary/applyToSubprocess)`,
    );
  }
  return {
    storeWired: pol.storeWired,
    ghBinary: pol.ghBinary,
    applyToSubprocess: pol.applyToSubprocess,
    transports: { issueQuery, close },
  };
}
