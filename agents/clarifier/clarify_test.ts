/**
 * Clarifier Gate 3 progress predicate — contract + existence-proof tests.
 *
 * What this test protects:
 *   The prompt at `.agent/clarifier/prompts/steps/closure/clarify/f_default.md`
 *   Step 3 (b) defines a *deterministic* progress predicate. That predicate
 *   MUST force `verdict = "ready-to-consider"` whenever:
 *     (i)  the current anchor signature equals the most-recent prior
 *          ready-to-impl signature, AND
 *     (ii) at least one iterator-failure timestamp is later than that
 *          prior verdict's `created_at`.
 *
 *   Because the predicate runs inside the LLM-executed prompt, a property
 *   test against the prompt itself is non-deterministic. Instead this file
 *   maintains a TypeScript *reference implementation* that mirrors the
 *   prompt rule literally, and asserts:
 *
 *   (A) the reference implementation's behaviour on a fixture derived
 *       from issue #530 (3 cycles of identical anchor `CHANGELOG.md:10`
 *       with `<!-- iterator-failure-v1 -->` comments inserted between
 *       cycles), establishing the existence proof: with the predicate in
 *       place, cycle 3 verdict flips to `ready-to-consider`.
 *   (B) the schema contract: `closure.clarify.anchor_signature` is in
 *       `required` and matches a sha256 hex pattern; the new
 *       `closure.clarify.scan-prior-verdicts` schema is wired into
 *       `steps_registry.json` with the expected handoff fields.
 *   (C) the prompt's anchor-signature canonicalization rule is satisfied
 *       by the reference implementation (sort + dedupe + LF-join + sha256
 *       lower-hex, plus the empty-list constant).
 *
 *   When the prompt's predicate definition is edited, this file's
 *   reference implementation MUST be updated to match — the test name
 *   states the invariant; the reference is the source-of-truth mirror.
 *
 * Source-of-truth files:
 *   - .agent/clarifier/schemas/clarifier.schema.json
 *   - .agent/clarifier/steps_registry.json
 *   - .agent/clarifier/prompts/steps/closure/clarify/f_default.md
 *   - .agent/clarifier/prompts/steps/closure/clarify/f_scan-prior-verdicts.md
 */

import { assert, assertEquals, assertMatch } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

/** Lowercase hex encoder (no extra deps). */
function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) {
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const CLARIFIER_DIR = join(REPO_ROOT, ".agent/clarifier");

// ---------------------------------------------------------------------------
// (C) Reference implementation — mirrors the prompt rule literally.
// ---------------------------------------------------------------------------

/**
 * Compute the anchor signature exactly as
 * `f_default.md` Step 3a specifies:
 *   1. trim each anchor
 *   2. sort ascending lexicographically
 *   3. deduplicate (Set)
 *   4. join with single LF
 *   5. sha256 → lower-case hex
 * Empty list → sha256 of the empty string.
 */
async function computeAnchorSignature(anchors: string[]): Promise<string> {
  const trimmed = anchors.map((a) => a.trim()).filter((a) => a.length > 0);
  const unique = [...new Set(trimmed)].sort();
  const joined = unique.join("\n");
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(joined),
  );
  return toHex(new Uint8Array(buf));
}

/** Empty-string sha256 constant per prompt (Step 3a). */
const EMPTY_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

interface PriorVerdict {
  created_at: string;
  anchor_signature: string | null;
  verdict: "ready-to-impl" | "ready-to-consider";
}

/**
 * Reference implementation of Gate 3 (b) progress predicate. Pure
 * function — given the same handoff inputs, returns the same boolean.
 *
 * Returns `true` when the predicate FAILS (= verdict must be forced
 * to `ready-to-consider`). Returns `false` when the predicate holds
 * (= verdict is free to be whatever the rubric otherwise dictates).
 */
function gate3ProgressPredicateFails(args: {
  current_signature: string;
  prior_anchor_signatures: PriorVerdict[];
  iterator_failure_timestamps: string[];
}): boolean {
  // (i) Find most recent prior ready-to-impl by created_at.
  const sorted = [...args.prior_anchor_signatures].sort((a, b) =>
    a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0
  );
  const lastReadyToImpl = [...sorted].reverse().find((p) =>
    p.verdict === "ready-to-impl"
  );
  if (!lastReadyToImpl) return false; // vacuously holds — 1st pass or only consider so far

  // (ii) Same signature?
  if (lastReadyToImpl.anchor_signature !== args.current_signature) return false;

  // (iii) Any iterator-failure timestamp strictly later than the prior verdict?
  const hasInterveningFailure = args.iterator_failure_timestamps.some((ts) =>
    ts > lastReadyToImpl.created_at
  );
  return hasInterveningFailure;
}

// ---------------------------------------------------------------------------
// (A) Existence proof — #530-style fixture.
// ---------------------------------------------------------------------------

Deno.test("Gate 3 progress predicate — #530 fixture forces ready-to-consider on cycle 3", async () => {
  // Fixture: identical anchor `CHANGELOG.md:10` re-emitted across 3 cycles
  // with iterator-failure comments between each clarifier verdict.
  const anchors = ["CHANGELOG.md:10"];
  const sig = await computeAnchorSignature(anchors);

  // Chronological history at the moment cycle 3's clarifier runs:
  //   T1  clarifier verdict ready-to-impl (sig X)
  //   T2  iterator failure
  //   T3  clarifier verdict ready-to-impl (sig X)        ← same signature
  //   T4  iterator failure
  //   --- cycle 3 clarifier runs here, computes sig X again ---
  const prior_anchor_signatures: PriorVerdict[] = [
    {
      created_at: "2026-04-19T14:00:00Z",
      anchor_signature: sig,
      verdict: "ready-to-impl",
    },
    {
      created_at: "2026-04-19T15:00:00Z",
      anchor_signature: sig,
      verdict: "ready-to-impl",
    },
  ];
  const iterator_failure_timestamps = [
    "2026-04-19T14:30:00Z",
    "2026-04-19T15:30:00Z",
  ];

  const fails = gate3ProgressPredicateFails({
    current_signature: sig,
    prior_anchor_signatures,
    iterator_failure_timestamps,
  });

  assert(
    fails,
    "Gate 3 (b) progress predicate must FAIL on identical-anchor + intervening iterator-failure scenario " +
      "(#530 cycles 7/9/11). Reference implementation says fails=false; this means the prompt's predicate logic " +
      "does not match the test fixture. Fix: re-read .agent/clarifier/prompts/steps/closure/clarify/f_default.md " +
      "Step 3 (b) and align computeAnchorSignature/gate3ProgressPredicateFails in this test file to the prompt rule.",
  );
});

Deno.test("Gate 3 progress predicate — 1st-pass (empty ledger) lets verdict pass", async () => {
  const sig = await computeAnchorSignature(["CHANGELOG.md:10"]);
  const fails = gate3ProgressPredicateFails({
    current_signature: sig,
    prior_anchor_signatures: [],
    iterator_failure_timestamps: [],
  });
  assert(
    !fails,
    "Empty ledger means 1st pass on this issue. Predicate must vacuously hold (fails=false) so the rubric is " +
      "free to emit ready-to-impl. Fix: review the early-return for empty `prior_anchor_signatures` in the " +
      "reference implementation; the prompt's wording is `If last_ready_to_impl is None → predicate vacuously holds`.",
  );
});

Deno.test("Gate 3 progress predicate — different anchor signature lets verdict pass", async () => {
  const oldSig = await computeAnchorSignature(["CHANGELOG.md:10"]);
  const newSig = await computeAnchorSignature(["agents/runner/factory.ts:42"]);
  const fails = gate3ProgressPredicateFails({
    current_signature: newSig,
    prior_anchor_signatures: [
      {
        created_at: "2026-04-19T14:00:00Z",
        anchor_signature: oldSig,
        verdict: "ready-to-impl",
      },
    ],
    iterator_failure_timestamps: ["2026-04-19T14:30:00Z"],
  });
  assert(
    !fails,
    "Different anchor signature = the clarifier moved to a fresh anchor after the iterator failure (= progress " +
      "made). Predicate must hold (fails=false). Fix: ensure the equality check on `anchor_signature` is the " +
      "*only* discriminator after `last_ready_to_impl` is found.",
  );
});

Deno.test("Gate 3 progress predicate — no intervening iterator-failure lets verdict pass", async () => {
  const sig = await computeAnchorSignature(["CHANGELOG.md:10"]);
  const fails = gate3ProgressPredicateFails({
    current_signature: sig,
    prior_anchor_signatures: [
      {
        created_at: "2026-04-19T14:00:00Z",
        anchor_signature: sig,
        verdict: "ready-to-impl",
      },
    ],
    // No iterator-failure timestamps (e.g., a re-run before iterator dispatched).
    iterator_failure_timestamps: [],
  });
  assert(
    !fails,
    "Without an intervening iterator-failure, anchor reuse is allowed (the iterator hasn't proven the anchor " +
      "wrong yet). Predicate must hold. Fix: the `iterator_failure_timestamps.some(ts > last_ready_to_impl.created_at)` " +
      "check must be a hard precondition for predicate failure, not a soft hint.",
  );
});

Deno.test("Gate 3 progress predicate — iterator-failure BEFORE last ready-to-impl does not trigger", async () => {
  const sig = await computeAnchorSignature(["CHANGELOG.md:10"]);
  const fails = gate3ProgressPredicateFails({
    current_signature: sig,
    prior_anchor_signatures: [
      {
        // Earlier consider verdict, no impact on predicate.
        created_at: "2026-04-19T13:00:00Z",
        anchor_signature: null,
        verdict: "ready-to-consider",
      },
      {
        created_at: "2026-04-19T15:00:00Z",
        anchor_signature: sig,
        verdict: "ready-to-impl",
      },
    ],
    iterator_failure_timestamps: [
      "2026-04-19T14:00:00Z", // BEFORE last ready-to-impl
    ],
  });
  assert(
    !fails,
    "Iterator failed BEFORE the most recent clarifier ready-to-impl — that failure was already considered " +
      "by that verdict, so it cannot retroactively invalidate it. Predicate must hold. Fix: ensure the " +
      "comparison is `iterator_failure_ts > last_ready_to_impl.created_at` (strict, in correct direction).",
  );
});

// ---------------------------------------------------------------------------
// (B) Schema / registry contract tests.
// ---------------------------------------------------------------------------

Deno.test("clarifier schema — closure.clarify requires anchor_signature with sha256 pattern", async () => {
  const schemaText = await Deno.readTextFile(
    join(CLARIFIER_DIR, "schemas/clarifier.schema.json"),
  );
  const schema = JSON.parse(schemaText) as Record<string, unknown>;
  const closureClarify = schema["closure.clarify"] as Record<string, unknown>;
  const required = closureClarify.required as string[];
  assert(
    required.includes("anchor_signature"),
    `closure.clarify.required must include "anchor_signature" so the predicate is mechanically parseable. ` +
      `Fix: edit .agent/clarifier/schemas/clarifier.schema.json — add "anchor_signature" to the required array.`,
  );
  const properties = closureClarify.properties as Record<string, unknown>;
  const anchorSig = properties.anchor_signature as Record<string, unknown>;
  assertEquals(
    anchorSig.type,
    "string",
    "anchor_signature.type must be 'string'. Fix: schema closure.clarify.properties.anchor_signature.type = 'string'.",
  );
  assertMatch(
    String(anchorSig.pattern),
    /\^\[a-f0-9\]\{64\}\$/,
    "anchor_signature.pattern must enforce sha256 lower-hex (64 chars). " +
      "Fix: schema closure.clarify.properties.anchor_signature.pattern = '^[a-f0-9]{64}$'.",
  );
});

Deno.test("clarifier schema — closure.clarify.scan-prior-verdicts is declared with required handoff fields", async () => {
  const schemaText = await Deno.readTextFile(
    join(CLARIFIER_DIR, "schemas/clarifier.schema.json"),
  );
  const schema = JSON.parse(schemaText) as Record<string, unknown>;
  const scan = schema["closure.clarify.scan-prior-verdicts"] as
    | Record<string, unknown>
    | undefined;
  assert(
    scan !== undefined,
    `closure.clarify.scan-prior-verdicts schema is missing. ` +
      `Fix: add a new top-level entry to .agent/clarifier/schemas/clarifier.schema.json describing the work ` +
      `step's output (next_action, prior_anchor_signatures[], iterator_failure_timestamps[]).`,
  );
  const required = scan.required as string[];
  for (
    const field of [
      "next_action",
      "prior_anchor_signatures",
      "iterator_failure_timestamps",
    ]
  ) {
    assert(
      required.includes(field),
      `closure.clarify.scan-prior-verdicts.required must include "${field}". ` +
        `Fix: append "${field}" to the required array in the new schema entry.`,
    );
  }
});

Deno.test("clarifier registry — scan-prior-verdicts step is wired between scan-iterator-failure and clarify", async () => {
  const registryText = await Deno.readTextFile(
    join(CLARIFIER_DIR, "steps_registry.json"),
  );
  const registry = JSON.parse(registryText) as Record<string, unknown>;
  const steps = registry.steps as Record<string, Record<string, unknown>>;

  const scan = steps["closure.clarify.scan-prior-verdicts"];
  assert(
    scan !== undefined,
    `closure.clarify.scan-prior-verdicts step is missing from registry. ` +
      `Fix: add the step entry to .agent/clarifier/steps_registry.json with kind:"work", uvVariables:["issue"], ` +
      `outputSchemaRef pointing to closure.clarify.scan-prior-verdicts, structuredGate handoffFields ` +
      `["prior_anchor_signatures","iterator_failure_timestamps"], and transitions.handoff.target = "clarify".`,
  );

  const upstream = steps["closure.clarify.scan-iterator-failure"];
  const upstreamTransitions = upstream.transitions as Record<
    string,
    Record<string, unknown>
  >;
  assertEquals(
    upstreamTransitions.handoff.target,
    "closure.clarify.scan-prior-verdicts",
    `closure.clarify.scan-iterator-failure must hand off to closure.clarify.scan-prior-verdicts (not directly to clarify). ` +
      `Fix: in .agent/clarifier/steps_registry.json, set scan-iterator-failure.transitions.handoff.target = ` +
      `"closure.clarify.scan-prior-verdicts".`,
  );

  const scanTransitions = scan.transitions as Record<
    string,
    Record<string, unknown>
  >;
  assertEquals(
    scanTransitions.handoff.target,
    "clarify",
    `closure.clarify.scan-prior-verdicts must hand off to "clarify". ` +
      `Fix: scan-prior-verdicts.transitions.handoff.target = "clarify".`,
  );

  const scanGate = scan.structuredGate as Record<string, unknown>;
  const handoffFields = scanGate.handoffFields as string[];
  for (
    const field of [
      "prior_anchor_signatures",
      "iterator_failure_timestamps",
    ]
  ) {
    assert(
      handoffFields.includes(field),
      `closure.clarify.scan-prior-verdicts.structuredGate.handoffFields must include "${field}" so ` +
        `the rubric step receives the ledger. Fix: append "${field}" to the handoffFields array.`,
    );
  }

  const clarifyStep = steps["clarify"];
  const clarifyGate = clarifyStep.structuredGate as Record<string, unknown>;
  const clarifyHandoff = clarifyGate.handoffFields as string[];
  assert(
    clarifyHandoff.includes("anchor_signature"),
    `clarify.structuredGate.handoffFields must include "anchor_signature" so the orchestrator carries the ` +
      `signature forward (audit trail / cross-cycle scan). ` +
      `Fix: append "anchor_signature" to clarify.structuredGate.handoffFields.`,
  );
});

// ---------------------------------------------------------------------------
// (C) anchor-signature canonicalization invariants.
// ---------------------------------------------------------------------------

Deno.test("computeAnchorSignature — empty list yields sha256 of empty string (per prompt Step 3a)", async () => {
  const sig = await computeAnchorSignature([]);
  assertEquals(
    sig,
    EMPTY_SHA256,
    `Empty anchor list must produce sha256 of empty string (${EMPTY_SHA256}). ` +
      `Fix: the trim+filter step must yield an empty array for inputs like [], [""], ["   "]; sha256 of joined ` +
      `empty string is the documented constant. Update either prompt or reference impl.`,
  );
});

Deno.test("computeAnchorSignature — order- and duplicate-independent (canonical)", async () => {
  const a = await computeAnchorSignature([
    "agents/runner/factory.ts:42",
    "agents/orchestrator/dispatcher.ts:142",
  ]);
  const b = await computeAnchorSignature([
    "agents/orchestrator/dispatcher.ts:142",
    "agents/runner/factory.ts:42",
  ]);
  const c = await computeAnchorSignature([
    "agents/runner/factory.ts:42",
    "agents/orchestrator/dispatcher.ts:142",
    "agents/runner/factory.ts:42", // duplicate
    "  agents/orchestrator/dispatcher.ts:142  ", // whitespace
  ]);
  assertEquals(
    a,
    b,
    "Anchor signature must be order-independent (sort step). Different sort order produced different signatures. " +
      "Fix: ensure the reference impl sorts before sha256, matching prompt Step 3a.",
  );
  assertEquals(
    a,
    c,
    "Anchor signature must be duplicate- and whitespace-trim independent. " +
      "Fix: ensure reference impl trims and dedupes before sort+sha256, matching prompt Step 3a.",
  );
});

Deno.test("computeAnchorSignature — produces 64-char lower-hex sha256", async () => {
  const sig = await computeAnchorSignature(["foo:1", "bar:2"]);
  assertMatch(
    sig,
    /^[a-f0-9]{64}$/,
    `Anchor signature must be 64 lowercase hex chars to satisfy the schema pattern. ` +
      `Fix: ensure toHex produces lowercase output (b.toString(16).padStart(2, "0")); schema pattern is '^[a-f0-9]{64}$'.`,
  );
});
