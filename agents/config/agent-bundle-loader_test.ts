/**
 * Tests for agents/config/agent-bundle-loader.ts
 *
 * Verifies that the AgentBundle aggregate is correctly assembled from
 * the 3 disk sources (agent.json + steps_registry.json +
 * workflow.json.agents.{id}) and that Boot rule A1 (id uniqueness)
 * fails-fast on duplicate ids.
 *
 * @see agents/docs/design/realistic/13-agent-config.md §B / §G
 */

import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import {
  assertUniqueBundleIds,
  loadAgentBundle,
} from "./agent-bundle-loader.ts";
import { ConfigError } from "../shared/errors/config-errors.ts";
import type {
  AgentBundle,
  ClosePrimary,
} from "../src_common/types/agent-bundle.ts";
import type { AgentDefinition as WorkflowAgentDefinition } from "../orchestrator/workflow-types.ts";

/**
 * Scaffold a minimally valid agent dir with `agent.json` +
 * `steps_registry.json` so the loader has something to read.
 */
async function scaffoldAgent(
  rootDir: string,
  agentName: string,
): Promise<string> {
  const agentDir = join(rootDir, ".agent", agentName);
  await Deno.mkdir(agentDir, { recursive: true });

  const agentJson = {
    version: "1.0.0",
    name: agentName,
    displayName: `${agentName} (test)`,
    description: "test agent for AgentBundle loader",
    parameters: {
      issue: {
        type: "number",
        description: "GitHub Issue number",
        required: true,
        cli: "--issue",
      },
    },
    runner: {
      flow: {
        systemPromptPath: "prompts/system.md",
        prompts: { registry: "steps_registry.json" },
      },
      verdict: {
        type: "count:iteration",
        config: { maxIterations: 5 },
      },
    },
  };
  await Deno.writeTextFile(
    join(agentDir, "agent.json"),
    JSON.stringify(agentJson, null, 2),
  );

  const registryJson = {
    agentId: agentName,
    version: "1.0.0",
    c1: "steps",
    entryStep: "initial.issue",
    steps: {
      "initial.issue": {
        stepId: "initial.issue",
        name: "Initial Issue",
        kind: "work",
        address: {
          c1: "steps",
          c2: "initial",
          c3: "issue",
          edition: "default",
        },
        uvVariables: ["issue"],
        usesStdin: false,
      },
      "verification.review": {
        stepId: "verification.review",
        name: "Verification Review",
        kind: "verification",
        address: {
          c1: "steps",
          c2: "verification",
          c3: "review",
          edition: "default",
        },
        uvVariables: [],
        usesStdin: false,
      },
      "closure.polling": {
        stepId: "closure.polling",
        name: "Closure Polling",
        kind: "closure",
        address: {
          c1: "steps",
          c2: "closure",
          c3: "polling",
          edition: "default",
        },
        uvVariables: ["issue"],
        usesStdin: false,
      },
    },
  };
  await Deno.writeTextFile(
    join(agentDir, "steps_registry.json"),
    JSON.stringify(registryJson, null, 2),
  );

  return agentDir;
}

Deno.test("loadAgentBundle - assembles aggregate from agent.json + steps_registry.json", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await scaffoldAgent(tempDir, "test-agent");

    const bundle = await loadAgentBundle("test-agent", tempDir);

    assertEquals(bundle.id, "test-agent");
    assertEquals(bundle.version, "1.0.0");
    assertEquals(bundle.displayName, "test-agent (test)");
    assertEquals(bundle.role, undefined, "role absent without workflow agent");

    // FlowSpec: workSteps include kind work + verification
    const workKinds = bundle.flow.workSteps.map((s) => s.kind).sort();
    assertEquals(workKinds, ["verification", "work"]);
    assertEquals(bundle.flow.entryStep, "initial.issue");

    // CompletionSpec: closureSteps only
    assertEquals(bundle.completion.closureSteps.length, 1);
    assertEquals(bundle.completion.closureSteps[0].kind, "closure");
    assertEquals(bundle.completion.verdictKind, "count:iteration");

    // ParamSpec[] from agent.json.parameters
    assertEquals(bundle.parameters.length, 1);
    assertEquals(bundle.parameters[0].name, "issue");
    assertEquals(bundle.parameters[0].required, true);
    assertEquals(bundle.parameters[0].cli, "--issue");

    // Full step list (work + verification + closure)
    assertEquals(bundle.steps.length, 3);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("loadAgentBundle - aggregates workflow.json.agents.{id} fields when supplied", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await scaffoldAgent(tempDir, "test-agent");
    const workflowAgent: WorkflowAgentDefinition = {
      role: "transformer",
      outputPhase: "ready",
      closeBinding: {
        primary: { kind: "direct" },
        cascade: false,
        condition: "approved",
      },
    };

    const bundle = await loadAgentBundle("test-agent", tempDir, {
      workflowAgent,
    });

    assertEquals(bundle.role, "transformer");
    assertEquals(bundle.closeBinding.primary.kind, "direct");
    assertEquals(bundle.closeBinding.condition, "approved");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// T6.2 — CloseBinding read-through (design 13 §F)
// ---------------------------------------------------------------------------

Deno.test("loadAgentBundle - closeBinding round-trips primary.kind == 'direct'", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await scaffoldAgent(tempDir, "test-agent");
    const workflowAgent: WorkflowAgentDefinition = {
      role: "transformer",
      outputPhase: "ready",
      closeBinding: {
        primary: { kind: "direct" },
        cascade: false,
      },
    };

    const bundle = await loadAgentBundle("test-agent", tempDir, {
      workflowAgent,
    });

    assertEquals(
      bundle.closeBinding.primary.kind,
      "direct",
      "closeBinding.primary.kind should round-trip 'direct' (design 13 §F)",
    );
    assertEquals(
      bundle.closeBinding.cascade,
      false,
      "cascade defaults to false when not declared on disk",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("loadAgentBundle - closeBinding round-trips primary.kind == 'none'", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await scaffoldAgent(tempDir, "test-agent");
    const workflowAgent: WorkflowAgentDefinition = {
      role: "validator",
      outputPhases: { approved: "ready", rejected: "blocked" },
      closeBinding: {
        primary: { kind: "none" },
        cascade: false,
      },
    };

    const bundle = await loadAgentBundle("test-agent", tempDir, {
      workflowAgent,
    });

    assertEquals(
      bundle.closeBinding.primary.kind,
      "none",
      "closeBinding.primary.kind should round-trip 'none' (design 13 §F)",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("loadAgentBundle - closeBinding defaults to none when workflowAgent absent (standalone)", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await scaffoldAgent(tempDir, "test-agent");

    // No workflowAgent → closeBinding defaults to { primary: { kind: "none" } }.
    const bundle = await loadAgentBundle("test-agent", tempDir);

    assertEquals(
      bundle.closeBinding.primary.kind,
      "none",
      "Absent closeBinding should default to primary.kind 'none'",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("CloseBinding - exhaustive over 5 primary.kind variants (compile-time + runtime)", () => {
  // Author every §F variant once; the discriminated union forces TS to
  // exhaust them via assertNever. If a variant is added or removed at the
  // type level, this test stops compiling.
  const variants: readonly ClosePrimary[] = [
    { kind: "direct" },
    { kind: "boundary" },
    { kind: "outboxPre" },
    { kind: "custom", channel: { channelId: "user.foo" } },
    { kind: "none" },
  ];

  const seen = new Set<ClosePrimary["kind"]>();
  for (const variant of variants) {
    switch (variant.kind) {
      case "direct":
      case "boundary":
      case "outboxPre":
      case "none":
        seen.add(variant.kind);
        break;
      case "custom":
        // T1.5: ContractDescriptor channelId is the only required field.
        assertEquals(variant.channel.channelId, "user.foo");
        seen.add(variant.kind);
        break;
      default: {
        const _exhaust: never = variant;
        throw new Error(
          `Non-exhaustive ClosePrimary switch at runtime: ${
            JSON.stringify(_exhaust)
          }`,
        );
      }
    }
  }

  assertEquals(
    seen.size,
    5,
    "ClosePrimary should have exactly 5 kinds (direct/boundary/outboxPre/custom/none)",
  );
});

// ---------------------------------------------------------------------------
// T1.5 — AgentRoleHint custom variant (design 13 §C)
// ---------------------------------------------------------------------------

Deno.test("AgentRoleHint - custom variant is a valid AgentBundle.role value (type round-trip)", async () => {
  // workflow.json's AgentRole stays 2-variant by design; the bundle-level
  // AgentRoleHint accepts `custom` directly. Construct an AgentBundle with
  // role:"custom" via the loader's standalone path (no workflowAgent), then
  // overwrite the role field structurally to confirm the type accepts it.
  const tempDir = await Deno.makeTempDir();
  try {
    await scaffoldAgent(tempDir, "test-agent");
    const baseBundle = await loadAgentBundle("test-agent", tempDir);

    const customBundle: AgentBundle = {
      ...baseBundle,
      role: "custom",
    };

    assertEquals(
      customBundle.role,
      "custom",
      "AgentRoleHint should accept the 'custom' 3rd variant (design 13 §C)",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("loadAgentBundle - returns deeply frozen aggregate", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await scaffoldAgent(tempDir, "test-agent");

    const bundle = await loadAgentBundle("test-agent", tempDir);

    assertEquals(Object.isFrozen(bundle), true, "bundle root frozen");
    assertEquals(Object.isFrozen(bundle.flow), true, "flow frozen");
    assertEquals(
      Object.isFrozen(bundle.completion),
      true,
      "completion frozen",
    );
    assertEquals(
      Object.isFrozen(bundle.parameters),
      true,
      "parameters frozen",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("assertUniqueBundleIds - accepts unique ids", () => {
  const bundles = [
    { id: "a" } as AgentBundle,
    { id: "b" } as AgentBundle,
    { id: "c" } as AgentBundle,
  ];
  assertUniqueBundleIds(bundles);
});

Deno.test("assertUniqueBundleIds - rejects duplicate ids with AC-BUNDLE-001", () => {
  const bundles = [
    { id: "iterator" } as AgentBundle,
    { id: "reviewer" } as AgentBundle,
    { id: "iterator" } as AgentBundle,
  ];

  let caught: unknown = null;
  try {
    assertUniqueBundleIds(bundles);
  } catch (e) {
    caught = e;
  }
  if (!(caught instanceof ConfigError)) {
    throw new Error(
      `Expected ConfigError(AC-BUNDLE-001), got ${
        caught instanceof Error ? caught.constructor.name : typeof caught
      }`,
    );
  }
  assertEquals(caught.code, "AC-BUNDLE-001");
});

Deno.test("loadAgentBundle - splits steps by kind into flow.workSteps vs completion.closureSteps", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await scaffoldAgent(tempDir, "test-agent");

    const bundle = await loadAgentBundle("test-agent", tempDir);

    // Disjoint kinds (Boot rule A4 invariant; T1.4 promotes to validator)
    const workIds = new Set(bundle.flow.workSteps.map((s) => s.stepId));
    const closureIds = new Set(
      bundle.completion.closureSteps.map((s) => s.stepId),
    );
    for (const id of workIds) {
      if (closureIds.has(id)) {
        throw new Error(
          `Step "${id}" appears in both flow.workSteps and completion.closureSteps`,
        );
      }
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("assertRejects placeholder for missing agent.json", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await assertRejects(
      () => loadAgentBundle("missing-agent", tempDir),
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Critique-3 #8 — agentId mismatch contract enforced through Boot path.
//
// `agents/common/step-registry_test.ts` covers `loadStepRegistry` directly, but
// the AgentBundle boot pipeline (loadAgentBundle → loadTypedSteps →
// loadStepRegistry) was previously exercised only with matching agentIds. A
// silent fixture drift (e.g., copy-paste of an `agent.json` `name` without
// updating `steps_registry.json` `agentId`) would not be caught at CI time and
// would only fail at first Boot in production.
//
// This test materializes the mismatch on disk and asserts the Boot path
// rejects with `ConfigError(SR-LOAD-002)` — the canonical
// `srLoadAgentIdMismatch` factory in `agents/shared/errors/config-errors.ts`.
// ---------------------------------------------------------------------------

Deno.test(
  "loadAgentBundle - rejects with SR-LOAD-002 when agent.json.name !== steps_registry.json.agentId (Boot path)",
  async () => {
    // Failure diagnostic — printed alongside any assertion failure below:
    //   agentId mismatch must be detected through Boot path; if this fails,
    //   a future fixture drift will silently break Boot without CI signal.
    const tempDir = await Deno.makeTempDir();
    try {
      const agentName = "alice";
      const mismatchedAgentId = "bob";
      const agentDir = join(tempDir, ".agent", agentName);
      await Deno.mkdir(agentDir, { recursive: true });

      // agent.json: declares name "alice"
      const agentJson = {
        version: "1.0.0",
        name: agentName,
        displayName: "Alice",
        description: "boot-path agentId mismatch fixture",
        runner: {
          flow: {
            systemPromptPath: "prompts/system.md",
            prompts: { registry: "steps_registry.json" },
          },
          verdict: {
            type: "count:iteration",
            config: { maxIterations: 1 },
          },
        },
      };
      await Deno.writeTextFile(
        join(agentDir, "agent.json"),
        JSON.stringify(agentJson, null, 2),
      );

      // steps_registry.json: declares agentId "bob" (intentionally mismatched)
      const registryJson = {
        agentId: mismatchedAgentId,
        version: "1.0.0",
        c1: "steps",
        entryStep: "initial.issue",
        steps: {
          "initial.issue": {
            stepId: "initial.issue",
            name: "Initial Issue",
            kind: "work",
            address: {
              c1: "steps",
              c2: "initial",
              c3: "issue",
              edition: "default",
            },
            uvVariables: [],
            usesStdin: false,
          },
          "closure.done": {
            stepId: "closure.done",
            name: "Closure Done",
            kind: "closure",
            address: {
              c1: "steps",
              c2: "closure",
              c3: "done",
              edition: "default",
            },
            uvVariables: [],
            usesStdin: false,
          },
        },
      };
      await Deno.writeTextFile(
        join(agentDir, "steps_registry.json"),
        JSON.stringify(registryJson, null, 2),
      );

      const caught = await assertRejects(
        () => loadAgentBundle(agentName, tempDir),
        ConfigError,
        "Registry agentId mismatch",
        "agentId mismatch must be detected through Boot path; if this fails, " +
          "a future fixture drift will silently break Boot without CI signal.",
      );

      assertEquals(
        caught.code,
        "SR-LOAD-002",
        "Boot path must surface srLoadAgentIdMismatch (SR-LOAD-002), not a " +
          "generic validation error — see agents/shared/errors/config-errors.ts.",
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
);
