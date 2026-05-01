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

import { __internals, RULE_CODES, validateBootArtifacts } from "./validate.ts";
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
// Happy path — synthetic artifact passes all 27 rules
// ---------------------------------------------------------------------------

Deno.test("validateBootArtifacts — synthetic happy-path passes all 27 rules", () => {
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
// Coverage — RULE_CODES enumerates 27 rules, no duplicates
// ---------------------------------------------------------------------------

Deno.test("validateBootArtifacts — RULE_CODES covers exactly 27 rules without duplicates", () => {
  assertEquals(RULE_CODES.length, 27, "27-rule contract");
  const seen = new Set(RULE_CODES);
  assertEquals(seen.size, RULE_CODES.length, "no duplicate rule codes");
});

Deno.test("validateBootArtifacts — every rule code has a per-rule helper exported via __internals", () => {
  for (const code of RULE_CODES) {
    const fnName = `validate${code}` as keyof typeof __internals;
    assert(
      typeof __internals[fnName] === "function",
      `Missing per-rule helper for ${code} (expected __internals.${fnName})`,
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
