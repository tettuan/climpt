/**
 * Unit tests for {@link validateBootArtifacts} (T2.2).
 *
 * Each new rule (W7, W10, A6, A7, A8, S7) gets at least one Reject
 * fixture. The orchestrator's coverage is asserted against the static
 * RULE_CODES list so no rule can be silently dropped from the chain.
 *
 * Synthetic-only tests: this suite does NOT touch the in-tree
 * `.agent/workflow.json`. The instructions explicitly call out the
 * pre-existing project-evaluator drift in the in-tree config — using
 * a real boot here would couple the test suite to that drift.
 *
 * @see agents/docs/design/realistic/12-workflow-config.md §F (W*)
 * @see agents/docs/design/realistic/13-agent-config.md     §G (A*)
 * @see agents/docs/design/realistic/14-step-registry.md    §G (S*)
 */

import { assert, assertEquals } from "@std/assert";

import {
  __internals,
  collectBootWarnings,
  REJECT_RULE_CODES,
  RULE_CODES,
  validateBootArtifacts,
  WARN_RULE_CODES,
} from "./validate.ts";
import { STEP_KIND_ALLOWED_INTENTS } from "../common/step-registry/types.ts";
import type { BootArtifacts } from "./types.ts";
import type { Policy, TransportPolicy } from "./policy.ts";
import type { AgentRegistry } from "./types.ts";
import type { AgentBundle } from "../src_common/types/agent-bundle.ts";
import type { Step } from "../common/step-registry/types.ts";
import {
  deriveInvocations,
  type WorkflowConfig,
} from "../orchestrator/workflow-types.ts";
import { isAccept, isReject } from "../shared/validation/mod.ts";
import { createCloseEventBus } from "../events/bus.ts";
import { createMockCloseTransport } from "../transports/close-transport.ts";
import { BoundaryCloseChannel } from "../channels/boundary-close.ts";
import { DirectCloseChannel } from "../channels/direct-close.ts";
import { MergeCloseAdapter } from "../channels/merge-close-adapter.ts";
import { OutboxClosePostChannel } from "../channels/outbox-close-post.ts";
import { OutboxClosePreChannel } from "../channels/outbox-close-pre.ts";
import { FileGitHubClient } from "../orchestrator/file-github-client.ts";
import { SubjectStore } from "../orchestrator/subject-store.ts";

// ---------------------------------------------------------------------------
// Synthetic fixture builders
// ---------------------------------------------------------------------------

/** Build a minimal-but-valid `Step` for a happy-path bundle. */
function makeStep(overrides: Partial<Step> = {}): Step {
  return {
    stepId: "initial.work",
    kind: "work",
    address: { c1: "steps", c2: "initial", c3: "work", edition: "default" },
    name: "initial.work",
    type: "prompt",
    uvVariables: [],
    usesStdin: false,
    structuredGate: {
      allowedIntents: ["next"],
      intentSchemaRef: "#/definitions/x",
      intentField: "next_action.action",
    },
    transitions: { next: { target: "closure.done" } },
    outputSchemaRef: { file: "schemas/initial.schema.json", schema: "Initial" },
    ...overrides,
  };
}

function makeClosureStep(overrides: Partial<Step> = {}): Step {
  return {
    stepId: "closure.done",
    kind: "closure",
    address: { c1: "steps", c2: "closure", c3: "done", edition: "default" },
    name: "closure.done",
    type: "prompt",
    uvVariables: [],
    usesStdin: false,
    structuredGate: {
      allowedIntents: ["closing"],
      intentSchemaRef: "#/definitions/x",
      intentField: "next_action.action",
    },
    transitions: { closing: { target: null } },
    outputSchemaRef: { file: "schemas/closure.schema.json", schema: "Closure" },
    ...overrides,
  };
}

/** Build a happy-path AgentBundle with 1 work + 1 closure step. */
function makeBundle(overrides: Partial<AgentBundle> = {}): AgentBundle {
  const steps: Step[] = [makeStep(), makeClosureStep()];
  const base: AgentBundle = {
    id: "fixture-agent",
    version: "1.0.0",
    displayName: "Fixture Agent",
    description: "happy-path fixture",
    role: "transformer",
    flow: {
      entryStep: "initial.work",
      workSteps: [steps[0]],
    },
    completion: {
      closureSteps: [steps[1]],
      verdictKind: "count:iteration",
    },
    parameters: [],
    steps,
    closeBinding: { primary: { kind: "none" }, cascade: false },
    runner: {} as AgentBundle["runner"],
    ...overrides,
  };
  return base;
}

/** Build an AgentRegistry over the supplied bundles (no A1 dup-check). */
function makeRegistry(list: ReadonlyArray<AgentBundle>): AgentRegistry {
  const byId = new Map(list.map((b) => [b.id, b]));
  return {
    all: list,
    lookup: (id: string) => byId.get(id),
  };
}

function makePolicy(transports?: Partial<TransportPolicy>): Policy {
  return {
    storeWired: true,
    ghBinary: "gh",
    applyToSubprocess: true,
    transports: {
      issueQuery: transports?.issueQuery ?? "real",
      close: transports?.close ?? "real",
    },
  };
}

function makeWorkflow(
  overrides: Partial<WorkflowConfig> = {},
): WorkflowConfig {
  const phases = overrides.phases ?? {
    ready: {
      type: "actionable" as const,
      priority: 1,
      agent: "fixture-agent",
    },
    done: { type: "terminal" as const },
  };
  const agents = overrides.agents ?? {
    "fixture-agent": {
      role: "transformer" as const,
      outputPhase: "done",
    },
  };
  const invocations = overrides.invocations ??
    deriveInvocations(phases, agents);
  return {
    version: "1.0.0",
    issueSource: { kind: "ghRepoIssues", projectMembership: "unbound" },
    labelMapping: { "kind:ready": "ready" },
    rules: { maxCycles: 5, cycleDelayMs: 1000 },
    ...overrides,
    phases,
    agents,
    invocations,
  };
}

function makeArtifacts(
  overrides: {
    workflow?: Partial<WorkflowConfig>;
    bundles?: ReadonlyArray<AgentBundle>;
    policy?: Policy;
  } = {},
): BootArtifacts {
  const bundles = overrides.bundles ?? [makeBundle()];
  // T3.4: BootArtifacts now carries a frozen `bus` and `runId`. The
  // validate_test suite does NOT exercise the bus contract — it only
  // validates the 26 rules — so a synthesized empty bus is sufficient.
  const bus = createCloseEventBus();
  // PR4-2a: synthetic seam fixtures. validate_test does not exercise
  // the seam contract — the 26 rules don't read these fields — but the
  // BootArtifacts shape now requires them.
  const githubClient = new FileGitHubClient(
    new SubjectStore("/dev/null/validate-test"),
  );
  const closeTransport = createMockCloseTransport([]);
  const agentRegistry = makeRegistry(bundles);
  const runId = "validate-test-run";
  // PR4-2b: BootArtifacts.directClose carries the concrete channel
  // reference. Subscribe pre-freeze for production parity.
  const directClose = new DirectCloseChannel({
    agentRegistry,
    closeTransport,
    bus,
    runId,
  });
  directClose.register(bus);
  // PR4-3: BootArtifacts also exposes Cpre / Cpost / E channels so the
  // outbox-processor + verdict adapter can delegate close-writes to
  // the channel layer (T4.4b / T4.4c). Subscribe pre-freeze for
  // production parity.
  const outboxClosePre = new OutboxClosePreChannel({
    closeTransport,
    bus,
    runId,
  });
  outboxClosePre.register(bus);
  const outboxClosePost = new OutboxClosePostChannel({
    closeTransport,
    github: githubClient,
    bus,
    runId,
  });
  outboxClosePost.register(bus);
  const boundaryClose = new BoundaryCloseChannel({
    closeTransport,
    bus,
    runId,
  });
  boundaryClose.register(bus);
  const mergeCloseAdapter = new MergeCloseAdapter({
    bus,
    runId,
    cwd: "/dev/null/validate-test",
  });
  bus.freeze();
  return {
    workflow: makeWorkflow(overrides.workflow),
    agentRegistry,
    schemas: new Map<string, unknown>(),
    policy: overrides.policy ?? makePolicy(),
    bus,
    runId,
    bootedAt: Date.now(),
    githubClient,
    closeTransport,
    directClose,
    outboxClosePre,
    outboxClosePost,
    boundaryClose,
    mergeCloseAdapter,
  };
}

// ---------------------------------------------------------------------------
// Happy path — synthetic artifact passes the Reject-tier rules
// ---------------------------------------------------------------------------

Deno.test("validateBootArtifacts — synthetic happy-path accepts (no Reject-tier violations)", () => {
  const decision = validateBootArtifacts(makeArtifacts());
  assert(
    isAccept(decision),
    `Expected Accept, got Reject:\n${
      isReject(decision)
        ? decision.errors.map((e) => `  [${e.code}] ${e.message}`).join("\n")
        : ""
    }`,
  );
});

// ---------------------------------------------------------------------------
// Coverage — RULE_CODES enumerates Reject ∪ Warn rules, no duplicates
// ---------------------------------------------------------------------------

Deno.test("validateBootArtifacts — RULE_CODES = REJECT_RULE_CODES ∪ WARN_RULE_CODES, no duplicates", () => {
  assertEquals(
    RULE_CODES.length,
    REJECT_RULE_CODES.length + WARN_RULE_CODES.length,
    "RULE_CODES is the disjoint union of Reject and Warn tiers",
  );
  const seen = new Set(RULE_CODES);
  assertEquals(seen.size, RULE_CODES.length, "no duplicate rule codes");
  // The two tiers must be disjoint (a rule cannot be both blocking and advisory).
  const rejectSet = new Set<string>(REJECT_RULE_CODES);
  for (const w of WARN_RULE_CODES) {
    assert(
      !rejectSet.has(w),
      `Warn-tier code "${w}" must not appear in REJECT_RULE_CODES`,
    );
  }
});

Deno.test("validateBootArtifacts — every Reject rule code has a `validate<code>` helper exported via __internals", () => {
  for (const code of REJECT_RULE_CODES) {
    const fnName = `validate${code}` as keyof typeof __internals;
    assert(
      typeof __internals[fnName] === "function",
      `Missing per-rule helper for ${code} (expected __internals.${fnName})`,
    );
  }
});

Deno.test("validateBootArtifacts — every Warn rule code has a `collect<code>Warnings` helper exported via __internals", () => {
  for (const code of WARN_RULE_CODES) {
    const fnName = `collect${code}Warnings` as keyof typeof __internals;
    assert(
      typeof __internals[fnName] === "function",
      `Missing warn helper for ${code} (expected __internals.${fnName})`,
    );
  }
});

// ---------------------------------------------------------------------------
// W7 (NEW) — issueSource × Policy integrity
// ---------------------------------------------------------------------------

Deno.test("W7 — gh* issueSource with Policy.transports.issueQuery=mock rejects", () => {
  const decision = validateBootArtifacts(makeArtifacts({
    policy: makePolicy({ issueQuery: "mock", close: "file" }),
    workflow: {
      issueSource: { kind: "ghRepoIssues", projectMembership: "unbound" },
    },
  }));
  assert(isReject(decision), "expected Reject for gh* + mock transport");
  if (isReject(decision)) {
    assert(
      decision.errors.some((e) => e.code === "W7"),
      `expected W7 in errors, got: ${
        decision.errors.map((e) => e.code).join(", ")
      }`,
    );
  }
});

// ---------------------------------------------------------------------------
// W10 (NEW) — Transport pair RR / RF / FF / MF
// ---------------------------------------------------------------------------

Deno.test("W10 — illegal pair (file, real) rejects", () => {
  const decision = validateBootArtifacts(makeArtifacts({
    policy: makePolicy({ issueQuery: "file", close: "real" }),
  }));
  assert(isReject(decision));
  if (isReject(decision)) {
    assert(
      decision.errors.some((e) => e.code === "W10"),
      `expected W10, got: ${decision.errors.map((e) => e.code).join(", ")}`,
    );
  }
});

Deno.test("W10 — illegal pair (mock, real) rejects", () => {
  const decision = validateBootArtifacts(makeArtifacts({
    policy: makePolicy({ issueQuery: "mock", close: "real" }),
  }));
  assert(isReject(decision));
  if (isReject(decision)) {
    assert(decision.errors.some((e) => e.code === "W10"));
  }
});

Deno.test("W10 — legal pair (real, file) accepts (combined with happy fixture)", () => {
  const decision = validateBootArtifacts(makeArtifacts({
    policy: makePolicy({ issueQuery: "real", close: "file" }),
  }));
  assert(isAccept(decision), "RF is a legal pair");
});

// ---------------------------------------------------------------------------
// W11 (NEW, T5.2) — invocation (phase, agentId, invocationIndex) unique
// ---------------------------------------------------------------------------
//
// Source of truth: agents/docs/design/realistic/12-workflow-config.md §F W11
// + 15 §C "phase versioning" guidance. Vacuously holds on the 1:1 disk shape
// (one invocation per phase) — the synthetic violation below installs two
// entries with the same (phase, agentId, invocationIndex) triple to prove
// the rule rejects multi-agent same-phase declarations until phase
// versioning is adopted.

Deno.test("W11 — duplicate (phase, agentId, invocationIndex) triple rejects", () => {
  // Take the happy fixture and inject a duplicate invocation. The base
  // workflow has one (ready, fixture-agent) pair; we add a second
  // (ready, fixture-agent, 0) entry — both default to invocationIndex=0
  // so the triple matches.
  const baseWorkflow = makeWorkflow();
  const violatingInvocations = [
    ...baseWorkflow.invocations,
    { phase: "ready", agentId: "fixture-agent" },
  ];
  const decision = validateBootArtifacts(makeArtifacts({
    workflow: { invocations: violatingInvocations },
  }));
  assert(isReject(decision), "expected Reject for duplicate invocation triple");
  if (isReject(decision)) {
    assert(
      decision.errors.some((e) => e.code === "W11"),
      `expected W11 in errors, got: ${
        decision.errors.map((e) => e.code).join(", ")
      }`,
    );
  }
});

Deno.test("W11 — same (phase, agentId) with distinct invocationIndex accepts (phase versioning prep)", () => {
  // When the disk schema gains explicit invocationIndex slots, two entries
  // with the same (phase, agentId) but different indexes must still pass.
  // This guards against an over-strict W11 implementation that only keys
  // on (phase, agentId).
  const baseWorkflow = makeWorkflow();
  const distinctIndexInvocations = [
    ...baseWorkflow.invocations,
    { phase: "ready", agentId: "fixture-agent", invocationIndex: 1 },
  ];
  const decision = validateBootArtifacts(makeArtifacts({
    workflow: { invocations: distinctIndexInvocations },
  }));
  assert(
    isAccept(decision),
    `expected Accept when invocationIndex distinguishes the entries, got: ${
      isReject(decision)
        ? decision.errors.map((e) => `[${e.code}] ${e.message}`).join("\n")
        : ""
    }`,
  );
});

// ---------------------------------------------------------------------------
// A6 (NEW) — closeBinding integrity
// ---------------------------------------------------------------------------

// T6.2 — A6 simplified: post-T6.2 the legacy `closeOnComplete` /
// `closeCondition` pair has been deleted from the type system, so the
// "double-source disagreement" pre-condition no longer exists. The
// remaining structural checks are: missing primary, custom with empty
// channelId.

Deno.test("A6 — primary.kind=custom with empty channelId rejects", () => {
  const bundle = makeBundle({
    closeBinding: {
      primary: { kind: "custom", channel: { channelId: "" } },
      cascade: false,
    },
  });
  const decision = validateBootArtifacts(makeArtifacts({ bundles: [bundle] }));
  assert(isReject(decision));
  if (isReject(decision)) {
    assert(decision.errors.some((e) => e.code === "A6"));
  }
});

// ---------------------------------------------------------------------------
// A7 (NEW) — ParamSpec name uniqueness
// ---------------------------------------------------------------------------

Deno.test("A7 — duplicate ParamSpec name rejects", () => {
  const bundle = makeBundle({
    parameters: [
      {
        name: "issue",
        type: "number",
        required: true,
        cli: "--issue",
      },
      {
        name: "issue",
        type: "string",
        required: false,
        cli: "--issue-alt",
      },
    ],
  });
  const decision = validateBootArtifacts(makeArtifacts({ bundles: [bundle] }));
  assert(isReject(decision));
  if (isReject(decision)) {
    assert(decision.errors.some((e) => e.code === "A7"));
  }
});

// ---------------------------------------------------------------------------
// A8 (NEW) — polling read-only constraint (RC1 lesson)
// ---------------------------------------------------------------------------

Deno.test("A8 — closure.polling step with non-empty postLLMConditions rejects", () => {
  const pollingStep: Step = makeClosureStep({
    stepId: "closure.polling",
    address: { c1: "steps", c2: "closure", c3: "polling", edition: "default" },
    retry: {
      maxAttempts: 3,
      postLLMConditions: ["validate-state"],
    },
  });
  const bundle = makeBundle({
    steps: [makeStep(), pollingStep],
    flow: {
      entryStep: "initial.work",
      workSteps: [makeStep()],
    },
    completion: {
      closureSteps: [pollingStep],
      verdictKind: "poll:state",
    },
  });
  const decision = validateBootArtifacts(makeArtifacts({ bundles: [bundle] }));
  assert(isReject(decision));
  if (isReject(decision)) {
    assert(
      decision.errors.some((e) => e.code === "A8"),
      `expected A8, got: ${decision.errors.map((e) => e.code).join(", ")}`,
    );
  }
});

Deno.test("A8 — closure.polling step with empty postLLMConditions accepts", () => {
  const pollingStep: Step = makeClosureStep({
    stepId: "closure.polling",
    address: { c1: "steps", c2: "closure", c3: "polling", edition: "default" },
  });
  // Re-target the work step's transition so S2 sees a valid graph.
  const workStep = makeStep({
    transitions: { next: { target: "closure.polling" } },
  });
  const bundle = makeBundle({
    steps: [workStep, pollingStep],
    flow: {
      entryStep: "initial.work",
      workSteps: [workStep],
    },
    completion: {
      closureSteps: [pollingStep],
      verdictKind: "poll:state",
    },
  });
  const decision = validateBootArtifacts(makeArtifacts({ bundles: [bundle] }));
  assert(
    isAccept(decision),
    `expected Accept, got Reject:\n${
      isReject(decision)
        ? decision.errors.map((e) => `  [${e.code}] ${e.message}`).join("\n")
        : ""
    }`,
  );
});

// ---------------------------------------------------------------------------
// S7 (NEW) — retry.patternRef ↔ failurePatterns
// ---------------------------------------------------------------------------

Deno.test("S7 — retry.onFailure.patternRef pointing at undeclared pattern rejects", () => {
  const stepWithRetry: Step = makeStep({
    stepId: "initial.work",
    retry: {
      maxAttempts: 2,
      onFailure: { patternRef: "ghost-pattern" },
    },
  });
  // No `runner.failurePatterns` declared — every patternRef is dangling.
  const bundle = makeBundle({
    steps: [stepWithRetry, makeClosureStep()],
    flow: {
      entryStep: "initial.work",
      workSteps: [stepWithRetry],
    },
  });
  const decision = validateBootArtifacts(makeArtifacts({ bundles: [bundle] }));
  assert(isReject(decision));
  if (isReject(decision)) {
    assert(
      decision.errors.some((e) => e.code === "S7"),
      `expected S7, got: ${decision.errors.map((e) => e.code).join(", ")}`,
    );
  }
});

Deno.test("S7 — retry.onFailure.patternRef matching a declared pattern accepts", () => {
  const stepWithRetry: Step = makeStep({
    stepId: "initial.work",
    retry: {
      maxAttempts: 2,
      onFailure: { patternRef: "git-dirty" },
    },
  });
  const runner = {
    failurePatterns: { "git-dirty": { edition: "failed" } },
  } as unknown as AgentBundle["runner"];
  const bundle = makeBundle({
    steps: [stepWithRetry, makeClosureStep()],
    flow: {
      entryStep: "initial.work",
      workSteps: [stepWithRetry],
    },
    runner,
  });
  const decision = validateBootArtifacts(makeArtifacts({ bundles: [bundle] }));
  assert(isAccept(decision), "declared patternRef accepts");
});

// ---------------------------------------------------------------------------
// Spot-checks on a few existing-validator-backed rules so the
// orchestrator's per-rule helper is non-trivially called.
// ---------------------------------------------------------------------------

Deno.test("A1 — duplicate AgentBundle id (raw registry) rejects with A1", () => {
  const dup = makeBundle({ id: "dup" });
  const decision = validateBootArtifacts(makeArtifacts({
    bundles: [dup, dup],
  }));
  assert(isReject(decision));
  if (isReject(decision)) {
    assert(decision.errors.some((e) => e.code === "A1"));
  }
});

Deno.test("A2 — malformed SemVer rejects with A2", () => {
  const bad = makeBundle({ version: "not-a-semver" });
  const decision = validateBootArtifacts(makeArtifacts({ bundles: [bad] }));
  assert(isReject(decision));
  if (isReject(decision)) {
    assert(decision.errors.some((e) => e.code === "A2"));
  }
});

Deno.test("S5 — bundle without any closure step rejects with S5", () => {
  const noClosure = makeBundle({
    steps: [makeStep()],
    flow: { entryStep: "initial.work", workSteps: [makeStep()] },
    completion: { closureSteps: [] },
  });
  const decision = validateBootArtifacts(makeArtifacts({
    bundles: [noClosure],
  }));
  assert(isReject(decision));
  if (isReject(decision)) {
    assert(decision.errors.some((e) => e.code === "S5"));
  }
});

Deno.test("W3 — phase referencing unregistered agent rejects with W3", () => {
  const decision = validateBootArtifacts(makeArtifacts({
    workflow: {
      phases: {
        ready: { type: "actionable", priority: 1, agent: "ghost-agent" },
        done: { type: "terminal" },
      },
      // Note: the `agents` map keeps `fixture-agent`; phases reference a
      // different id so AgentRegistry.lookup returns undefined for it.
    },
  }));
  assert(isReject(decision));
  if (isReject(decision)) {
    assert(
      decision.errors.some((e) => e.code === "W3" || e.code === "W2"),
      `expected W3/W2 in errors, got: ${
        decision.errors.map((e) => e.code).join(", ")
      }`,
    );
  }
});

// ---------------------------------------------------------------------------
// S9 (NEW, self-route §4.4) — adaptationChain element resolvability
// ---------------------------------------------------------------------------
//
// Both-sides invariant verification (per `contradiction-verification`):
//   silence ⇔ structurally valid chain element
//   error   ⇔ at least one element fails the C3L `adaptation` segment shape
//
// Source of truth for the structural rule lives in
// `agents/boot/validate.ts:adaptationChainElementViolation` (the resolver-side
// path template `f_{edition}_{adaptation}.md` — see `prompt-resolver.ts:formatC3LPath`).
// On-disk file existence is delegated to the loader's path-validator (matching
// the S6 / A5 split documented in `validate.ts` §"Coverage policy") so that
// `validateBootArtifacts` stays a pure synchronous function.

Deno.test("S9 (silence) — declared adaptationChain with structurally valid elements emits no S9", () => {
  const bundle = makeBundle({
    steps: [
      makeStep({ adaptationChain: ["default"] }),
      makeClosureStep({ adaptationChain: ["default", "git-dirty"] }),
    ],
    flow: {
      entryStep: "initial.work",
      workSteps: [makeStep({ adaptationChain: ["default"] })],
    },
    completion: {
      closureSteps: [
        makeClosureStep({ adaptationChain: ["default", "git-dirty"] }),
      ],
      verdictKind: "count:iteration",
    },
  });
  const decision = validateBootArtifacts(makeArtifacts({ bundles: [bundle] }));
  if (isReject(decision)) {
    const s9 = decision.errors.filter((e) => e.code === "S9");
    assertEquals(
      s9.length,
      0,
      `Expected no S9 errors, got: ${s9.map((e) => e.message).join("\n")}`,
    );
  }
  // Accept-or-no-S9 is the contract; full Accept also acceptable.
  assert(
    isAccept(decision) ||
      (isReject(decision) &&
        decision.errors.every((e) => e.code !== "S9")),
  );
});

Deno.test("S9 (error) — adaptationChain with empty-string element rejects with S9", () => {
  const bundle = makeBundle({
    steps: [
      makeStep({ adaptationChain: ["default", ""] }),
      makeClosureStep({ adaptationChain: ["default"] }),
    ],
    flow: {
      entryStep: "initial.work",
      workSteps: [makeStep({ adaptationChain: ["default", ""] })],
    },
    completion: {
      closureSteps: [makeClosureStep({ adaptationChain: ["default"] })],
      verdictKind: "count:iteration",
    },
  });
  const decision = validateBootArtifacts(makeArtifacts({ bundles: [bundle] }));
  assert(isReject(decision), "expected Reject for empty chain element");
  if (isReject(decision)) {
    assert(
      decision.errors.some((e) => e.code === "S9"),
      `expected S9 in errors, got: ${
        decision.errors.map((e) => e.code).join(", ")
      }`,
    );
  }
});

Deno.test("S9 (error) — adaptationChain element containing a path separator rejects with S9", () => {
  // A path separator would let the resolver escape `f_{edition}_{adaptation}.md`
  // and target an arbitrary file — the same class of violation the existing A5
  // schemaRef check rejects. Surface as S9 here so the diagnostic is local to
  // the chain element.
  const bundle = makeBundle({
    steps: [
      makeStep({ adaptationChain: ["default", "../escape"] }),
      makeClosureStep({ adaptationChain: ["default"] }),
    ],
    flow: {
      entryStep: "initial.work",
      workSteps: [
        makeStep({ adaptationChain: ["default", "../escape"] }),
      ],
    },
    completion: {
      closureSteps: [makeClosureStep({ adaptationChain: ["default"] })],
      verdictKind: "count:iteration",
    },
  });
  const decision = validateBootArtifacts(makeArtifacts({ bundles: [bundle] }));
  assert(isReject(decision));
  if (isReject(decision)) {
    assert(
      decision.errors.some((e) => e.code === "S9"),
      `expected S9, got: ${decision.errors.map((e) => e.code).join(", ")}`,
    );
  }
});

Deno.test("S9 (silence) — empty adaptationChain emits no S9 (no element to validate)", () => {
  // Whether `[]` is itself an allowed declaration is a separate concern (a
  // future S11 could ban it); S9 only fires per element, so an empty chain
  // has nothing to flag. This guards against an over-eager S9 implementation.
  const bundle = makeBundle({
    steps: [
      makeStep({ adaptationChain: [] }),
      makeClosureStep({ adaptationChain: [] }),
    ],
    flow: {
      entryStep: "initial.work",
      workSteps: [makeStep({ adaptationChain: [] })],
    },
    completion: {
      closureSteps: [makeClosureStep({ adaptationChain: [] })],
      verdictKind: "count:iteration",
    },
  });
  const decision = validateBootArtifacts(makeArtifacts({ bundles: [bundle] }));
  if (isReject(decision)) {
    const s9 = decision.errors.filter((e) => e.code === "S9");
    assertEquals(
      s9.length,
      0,
      `Expected no S9 errors on empty chain, got: ${
        s9.map((e) => e.message).join("\n")
      }`,
    );
  }
});

Deno.test("S9 (silence) — undeclared adaptationChain emits no S9 (S10 covers undeclared)", () => {
  // S9 fires only on declared chains; undeclared chains are S10's domain
  // (advisory warn). The default fixture leaves adaptationChain undefined.
  const decision = validateBootArtifacts(makeArtifacts());
  if (isReject(decision)) {
    const s9 = decision.errors.filter((e) => e.code === "S9");
    assertEquals(
      s9.length,
      0,
      `Expected no S9 errors when chain is undeclared, got: ${
        s9.map((e) => e.message).join("\n")
      }`,
    );
  }
});

// ---------------------------------------------------------------------------
// S10 (NEW, self-route §4.4) — kind-allows-repeat ∧ adaptationChain undeclared
// ---------------------------------------------------------------------------
//
// Both-sides invariant verification (per `contradiction-verification`):
//   silence ⇔ adaptationChain declared (any value, even [] or ["default"])
//   warn    ⇔ adaptationChain undeclared AND step.kind admits "repeat"
//
// Source of truth for the kind→intent mapping is
// `STEP_KIND_ALLOWED_INTENTS` (imported above) — tests must NOT hard-code
// the per-kind allowed-intent list.

Deno.test("S10 (silence) — step with declared adaptationChain emits no S10", () => {
  const bundle = makeBundle({
    steps: [
      makeStep({ adaptationChain: ["default"] }),
      makeClosureStep({ adaptationChain: ["default"] }),
    ],
    flow: {
      entryStep: "initial.work",
      workSteps: [makeStep({ adaptationChain: ["default"] })],
    },
    completion: {
      closureSteps: [makeClosureStep({ adaptationChain: ["default"] })],
      verdictKind: "count:iteration",
    },
  });
  const warnings = collectBootWarnings(makeArtifacts({ bundles: [bundle] }));
  const s10 = warnings.filter((w) => w.code === "S10");
  assertEquals(
    s10.length,
    0,
    `Expected no S10 warns when chain is declared, got:\n${
      s10.map((w) => `  ${w.message}`).join("\n")
    }`,
  );
});

Deno.test("S10 (warn) — repeat-allowing kind with undeclared adaptationChain emits S10", () => {
  // Pick a kind that admits "repeat" via the source-of-truth table — using
  // the table directly avoids hard-coding the per-kind set in this test.
  const repeatAllowingKinds = (Object.keys(STEP_KIND_ALLOWED_INTENTS) as Array<
    keyof typeof STEP_KIND_ALLOWED_INTENTS
  >).filter((k) => STEP_KIND_ALLOWED_INTENTS[k].includes("repeat"));
  assert(
    repeatAllowingKinds.length > 0,
    "STEP_KIND_ALLOWED_INTENTS must declare at least one repeat-allowing kind",
  );

  // The default fixture leaves adaptationChain undeclared and uses kind="work"
  // (which admits "repeat" per the table). The fixture therefore exercises
  // exactly the warn pre-condition.
  const warnings = collectBootWarnings(makeArtifacts());
  const s10 = warnings.filter((w) => w.code === "S10");
  assert(
    s10.length > 0,
    `Expected at least one S10 warn for the default fixture (kind=work, chain undeclared), got none`,
  );
});

Deno.test("S10 (smoke) — multi-step registry without adaptationChain warns once per repeat-allowing step", () => {
  // Documents the design's "intentional high firing rate" as a test
  // invariant: every repeat-allowing step that pre-dates the rule fires
  // S10 exactly once. The count is not hard-coded — it is derived from
  // `STEP_KIND_ALLOWED_INTENTS` (source of truth) and the bundle shape.
  const stepA = makeStep({ stepId: "initial.a" });
  const stepB = makeStep({
    stepId: "initial.b",
    transitions: { next: { target: "closure.done" } },
  });
  const closure = makeClosureStep();
  const bundle = makeBundle({
    steps: [stepA, stepB, closure],
    flow: {
      entryStep: "initial.a",
      workSteps: [stepA, stepB],
    },
    completion: {
      closureSteps: [closure],
      verdictKind: "count:iteration",
    },
  });

  const expectedWarns = bundle.steps.filter(
    (s) =>
      s.adaptationChain === undefined &&
      STEP_KIND_ALLOWED_INTENTS[s.kind].includes("repeat"),
  ).length;
  assert(
    expectedWarns >= 1,
    "fixture must include at least one repeat-allowing step without adaptationChain",
  );

  const warnings = collectBootWarnings(makeArtifacts({ bundles: [bundle] }));
  const s10 = warnings.filter((w) => w.code === "S10");
  assertEquals(
    s10.length,
    expectedWarns,
    `S10 must fire once per repeat-allowing step lacking adaptationChain (expected ${expectedWarns}, got ${s10.length})`,
  );
});

Deno.test("S10 — warns do NOT block validateBootArtifacts (Boot still accepts)", () => {
  // The Boot fail-fast invariant: warns are advisory; Reject is reserved
  // for gate-relevant violations. Even when S10 fires (default fixture
  // does), the orchestrator returns Accept.
  const artifacts = makeArtifacts();
  const warnings = collectBootWarnings(artifacts);
  const s10 = warnings.filter((w) => w.code === "S10");
  assert(
    s10.length > 0,
    "fixture must trigger at least one S10 to make this test meaningful",
  );

  const decision = validateBootArtifacts(artifacts);
  assert(
    isAccept(decision),
    `Boot must accept despite ${s10.length} S10 warn(s); got Reject:\n${
      isReject(decision)
        ? decision.errors.map((e) => `  [${e.code}] ${e.message}`).join("\n")
        : ""
    }`,
  );
});
