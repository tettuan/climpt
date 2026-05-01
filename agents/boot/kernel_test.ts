/**
 * Unit tests for {@link BootKernel}.
 *
 * Phase 2 (T2.1) scope:
 *  - Smoke: a synthesized minimal `.agent/workflow.json` boots cleanly.
 *  - In-tree: when every agent declared in the in-tree
 *    `.agent/workflow.json` has a matching agent dir, Boot accepts.
 *    The test is tolerant of missing on-disk agent dirs (a separate
 *    config-state issue, surfaced as A2 by Boot) so this suite stays
 *    green regardless of which agents have shipped to date.
 *  - Freeze: `BootArtifacts` is deeply frozen (Layer 4 immutable per
 *    design 20 §E + Critique F1 single-freeze invariant).
 *  - Registry: `lookup(existing)` + `lookup(nonexistent)` behave per
 *    {@link AgentRegistry} contract.
 *  - A1: duplicate AgentBundle id surfaces as Reject (rule A1 — design
 *    13 §G).
 *  - Policy: defaults match {@link loadPolicy} contract.
 *
 * @see agents/docs/design/realistic/10-system-overview.md §B
 * @see agents/docs/design/realistic/20-state-hierarchy.md §B / §E
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";

import { BootKernel } from "./kernel.ts";
import { createAgentRegistry } from "./registry.ts";
import {
  bootPolicyFilePath,
  loadPolicy,
  readBootPolicyFile,
} from "./policy.ts";
import type { AgentBundle } from "../src_common/types/agent-bundle.ts";
import { isAccept, isReject } from "../shared/validation/mod.ts";
import { SubscribeAfterBootError } from "../events/bus.ts";

const REPO_ROOT = new URL("../..", import.meta.url).pathname;

// ---------------------------------------------------------------------------
// Synthetic fixture — a minimal but valid 1-agent workflow on disk.
// Used by the smoke / freeze / registry tests so they do not depend on the
// shape of the in-tree workflow.
// ---------------------------------------------------------------------------

async function scaffoldFixtureWorkspace(
  tmpRoot: string,
  agentIds: readonly string[],
): Promise<void> {
  const agentDirRoot = join(tmpRoot, ".agent");
  await Deno.mkdir(agentDirRoot, { recursive: true });

  // workflow.json
  const phases: Record<string, unknown> = {
    ready: { type: "actionable", priority: 1, agent: agentIds[0] },
    done: { type: "terminal" },
  };
  const agents: Record<string, unknown> = {};
  for (const id of agentIds) {
    agents[id] = {
      role: "transformer",
      directory: id,
      outputPhase: "done",
    };
  }
  const labelMapping: Record<string, string> = { "kind:ready": "ready" };
  const workflow = {
    version: "1.0.0",
    issueSource: { kind: "ghRepoIssues", projectMembership: "unbound" },
    phases,
    labelMapping,
    agents,
    rules: { maxCycles: 5, cycleDelayMs: 1000 },
  };
  await Deno.writeTextFile(
    join(agentDirRoot, "workflow.json"),
    JSON.stringify(workflow, null, 2),
  );

  // Per-agent agent.json + steps_registry.json
  for (const id of agentIds) {
    const agentDir = join(agentDirRoot, id);
    await Deno.mkdir(agentDir, { recursive: true });
    const agentJson = {
      version: "1.0.0",
      name: id,
      displayName: `${id} (test)`,
      description: "fixture agent for BootKernel test",
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
        verdict: { type: "count:iteration", config: { maxIterations: 5 } },
      },
    };
    await Deno.writeTextFile(
      join(agentDir, "agent.json"),
      JSON.stringify(agentJson, null, 2),
    );

    const registryJson = {
      agentId: id,
      version: "1.0.0",
      c1: "steps",
      entryStepMapping: {
        "count:iteration": {
          initial: "initial.issue",
          continuation: "initial.issue",
        },
      },
      steps: {
        "initial.issue": {
          stepId: "initial.issue",
          kind: "work",
          address: {
            c1: "steps",
            c2: "initial",
            c3: "issue",
            edition: "default",
          },
          name: "Initial Issue Work",
          uvVariables: ["issue"],
          usesStdin: false,
        },
        "closure.polling": {
          stepId: "closure.polling",
          kind: "closure",
          address: {
            c1: "steps",
            c2: "closure",
            c3: "polling",
            edition: "default",
          },
          name: "Closure Polling",
          uvVariables: ["issue"],
          usesStdin: false,
        },
      },
    };
    await Deno.writeTextFile(
      join(agentDir, "steps_registry.json"),
      JSON.stringify(registryJson, null, 2),
    );
  }
}

// ---------------------------------------------------------------------------
// Smoke — synthesized workspace boots cleanly
// ---------------------------------------------------------------------------

Deno.test("BootKernel.boot — synthesized workflow.json boots cleanly", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    await scaffoldFixtureWorkspace(tmp, ["sample-agent"]);

    const decision = await BootKernel.boot({ cwd: tmp });
    assert(
      isAccept(decision),
      `Expected Accept, got Reject:\n${
        isReject(decision)
          ? decision.errors.map((e) => `  [${e.code}] ${e.message}`).join("\n")
          : ""
      }`,
    );
    if (isAccept(decision)) {
      const a = decision.value;
      assertEquals(a.workflow.version, "1.0.0");
      assertEquals(a.agentRegistry.all.length, 1);
      assertEquals(a.agentRegistry.all[0].id, "sample-agent");
      assertEquals(typeof a.bootedAt, "number");
    }
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// In-tree workflow — boots cleanly OR rejects with rule-coded errors only.
// This guards against W1 / A2 regressions without coupling to which agents
// happen to be shipped at any given time.
// ---------------------------------------------------------------------------

Deno.test("BootKernel.boot — in-tree workflow returns rule-coded Decision", async () => {
  const decision = await BootKernel.boot({ cwd: REPO_ROOT });

  if (isReject(decision)) {
    // Every error must have a known rule code; nothing should leak as a
    // raw exception or an unrecognized prefix.
    for (const err of decision.errors) {
      assert(
        /^[WAS]\d+$/.test(err.code),
        `Unrecognized rule code: ${err.code}`,
      );
    }
  } else {
    // Accept path: smoke-check the artifact shape.
    assert(decision.value.workflow.version);
    assert(decision.value.agentRegistry.all.length > 0);
  }
});

// ---------------------------------------------------------------------------
// Freeze — every node in BootArtifacts is `Object.isFrozen`
// ---------------------------------------------------------------------------

Deno.test("BootKernel.boot — BootArtifacts is deeply frozen", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    await scaffoldFixtureWorkspace(tmp, ["sample-agent"]);
    const decision = await BootKernel.boot({ cwd: tmp });
    assert(isAccept(decision));
    if (!isAccept(decision)) return;

    const a = decision.value;
    assert(Object.isFrozen(a), "root BootArtifacts must be frozen");
    assert(Object.isFrozen(a.workflow), "workflow must be frozen");
    assert(
      Object.isFrozen(a.workflow.phases),
      "workflow.phases must be frozen",
    );
    assert(
      Object.isFrozen(a.workflow.agents),
      "workflow.agents must be frozen",
    );
    assert(Object.isFrozen(a.workflow.rules), "workflow.rules must be frozen");
    assert(Object.isFrozen(a.policy), "policy must be frozen");
    assert(
      Object.isFrozen(a.policy.transports),
      "policy.transports must be frozen",
    );
    assert(Object.isFrozen(a.agentRegistry), "agentRegistry must be frozen");
    assert(
      Object.isFrozen(a.agentRegistry.all),
      "agentRegistry.all must be frozen",
    );
    // Spot-check the first bundle is also frozen.
    assert(
      Object.isFrozen(a.agentRegistry.all[0]),
      "first bundle must be frozen",
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Registry lookup contract
// ---------------------------------------------------------------------------

Deno.test("BootArtifacts.agentRegistry.lookup — returns bundle for existing id", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    await scaffoldFixtureWorkspace(tmp, ["sample-agent"]);
    const decision = await BootKernel.boot({ cwd: tmp });
    assert(isAccept(decision));
    if (!isAccept(decision)) return;

    const registry = decision.value.agentRegistry;
    const bundle = registry.lookup("sample-agent");
    assert(
      bundle !== undefined,
      'lookup("sample-agent") must not be undefined',
    );
    assertEquals(bundle.id, "sample-agent");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("BootArtifacts.agentRegistry.lookup — returns undefined for unknown id", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    await scaffoldFixtureWorkspace(tmp, ["sample-agent"]);
    const decision = await BootKernel.boot({ cwd: tmp });
    assert(isAccept(decision));
    if (!isAccept(decision)) return;

    const registry = decision.value.agentRegistry;
    assertEquals(registry.lookup("definitely-not-an-agent"), undefined);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Rule A1 — duplicate AgentBundle id surfaces as Reject(A1)
// ---------------------------------------------------------------------------

const stubBundle = (id: string): AgentBundle =>
  ({
    id,
    version: "1.0.0",
    displayName: id,
    description: "fixture",
    flow: { entryStep: "", workSteps: [] },
    completion: { closureSteps: [] },
    parameters: [],
    steps: [],
    closeBinding: { primary: { kind: "none" }, cascade: false },
    runner: {} as AgentBundle["runner"],
  }) as unknown as AgentBundle;

Deno.test("createAgentRegistry — duplicate id rejects with code A1", () => {
  const decision = createAgentRegistry([stubBundle("dup"), stubBundle("dup")]);

  assert(isReject(decision), "duplicate id must reject");
  if (isReject(decision)) {
    assertEquals(decision.errors.length, 1, "one duplicate group");
    assertEquals(decision.errors[0].code, "A1");
    assert(
      decision.errors[0].message.includes("dup"),
      `error message should mention duplicate id, got: ${
        decision.errors[0].message
      }`,
    );
  }
});

Deno.test("createAgentRegistry — unique ids accept", () => {
  const decision = createAgentRegistry([stubBundle("a"), stubBundle("b")]);

  assert(isAccept(decision));
  if (isAccept(decision)) {
    assertEquals(decision.value.all.length, 2);
    assertEquals(decision.value.lookup("a")?.id, "a");
    assertEquals(decision.value.lookup("b")?.id, "b");
  }
});

// ---------------------------------------------------------------------------
// Policy defaults
// ---------------------------------------------------------------------------

Deno.test("loadPolicy — default values match design 20 §B", () => {
  const policy = loadPolicy("/tmp/anywhere");
  assertEquals(policy.storeWired, true);
  assertEquals(policy.ghBinary, "gh");
  assertEquals(policy.applyToSubprocess, true);
  assertEquals(policy.transports.issueQuery, "real");
  assertEquals(policy.transports.close, "real");
});

Deno.test("loadPolicy — opts override defaults", () => {
  const policy = loadPolicy("/tmp/anywhere", {
    ghBinary: "/usr/local/bin/gh",
    storeWired: false,
    applyToSubprocess: false,
    transports: { issueQuery: "file", close: "file" },
  });
  assertEquals(policy.ghBinary, "/usr/local/bin/gh");
  assertEquals(policy.storeWired, false);
  assertEquals(policy.applyToSubprocess, false);
  assertEquals(policy.transports.issueQuery, "file");
  assertEquals(policy.transports.close, "file");
});

// ---------------------------------------------------------------------------
// Reject path — workflow file missing
// ---------------------------------------------------------------------------

Deno.test("BootKernel.boot — missing workflow.json rejects (W1)", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const decision = await BootKernel.boot({ cwd: tmp });
    assert(isReject(decision), "missing workflow.json must reject");
    if (isReject(decision)) {
      assertEquals(decision.errors[0].code, "W1");
    }
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// T3.4 — CloseEventBus + runId on BootArtifacts
// ---------------------------------------------------------------------------

Deno.test("BootKernel.boot — exposes a frozen CloseEventBus on artifacts", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    await scaffoldFixtureWorkspace(tmp, ["sample-agent"]);
    const decision = await BootKernel.boot({
      cwd: tmp,
      // Disable diagnostic so the assertion focuses on bus presence /
      // freeze and we don't depend on tmp/logs being writable.
      disableDiagnostic: true,
    });
    assert(isAccept(decision));
    if (!isAccept(decision)) return;

    const a = decision.value;
    assert(a.bus !== undefined, "BootArtifacts.bus must exist");
    assertEquals(
      a.bus.isFrozen(),
      true,
      "bus must be frozen by Boot before deepFreeze",
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("BootKernel.boot — bus.subscribe after boot throws SubscribeAfterBootError", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    await scaffoldFixtureWorkspace(tmp, ["sample-agent"]);
    const decision = await BootKernel.boot({
      cwd: tmp,
      disableDiagnostic: true,
    });
    assert(isAccept(decision));
    if (!isAccept(decision)) return;

    let caught: unknown;
    try {
      decision.value.bus.subscribe({}, () => {});
    } catch (err) {
      caught = err;
    }
    assert(
      caught instanceof SubscribeAfterBootError,
      "subscribe after Boot must throw SubscribeAfterBootError",
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("BootKernel.boot — runId is a non-empty string", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    await scaffoldFixtureWorkspace(tmp, ["sample-agent"]);
    const decision = await BootKernel.boot({
      cwd: tmp,
      disableDiagnostic: true,
    });
    assert(isAccept(decision));
    if (!isAccept(decision)) return;

    const { runId } = decision.value;
    assertEquals(typeof runId, "string", "runId must be string");
    assert(runId.length > 0, "runId must be non-empty");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("BootKernel.boot — two boots produce distinct runIds and distinct buses", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    await scaffoldFixtureWorkspace(tmp, ["sample-agent"]);
    const d1 = await BootKernel.boot({ cwd: tmp, disableDiagnostic: true });
    const d2 = await BootKernel.boot({ cwd: tmp, disableDiagnostic: true });
    assert(isAccept(d1) && isAccept(d2));
    if (!(isAccept(d1) && isAccept(d2))) return;

    assert(
      d1.value.runId !== d2.value.runId,
      "each boot must mint a unique runId (Critique F1: re-deploy = new boot)",
    );
    assert(
      d1.value.bus !== d2.value.bus,
      "each boot must mint a fresh bus instance",
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// T3.4 — bootStandalone exposes the same bus + runId surface
// ---------------------------------------------------------------------------

Deno.test("BootKernel.bootStandalone — exposes frozen bus + runId", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    await scaffoldFixtureWorkspace(tmp, ["sample-agent"]);
    const decision = await BootKernel.bootStandalone({
      cwd: tmp,
      agentName: "sample-agent",
      disableDiagnostic: true,
    });
    assert(isAccept(decision));
    if (!isAccept(decision)) return;

    const a = decision.value;
    assertEquals(a.bus.isFrozen(), true);
    assertEquals(typeof a.runId, "string");
    assert(a.runId.length > 0);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// T6.4 — Layer-4 inheritance via boot-policy file (design 20 §E)
// ---------------------------------------------------------------------------

Deno.test(
  "BootKernel.boot — writes tmp/boot-policy-<runId>.json when applyToSubprocess=true",
  async () => {
    const tmp = await Deno.makeTempDir();
    try {
      await scaffoldFixtureWorkspace(tmp, ["sample-agent"]);
      const decision = await BootKernel.boot({
        cwd: tmp,
        disableDiagnostic: true,
      });
      assert(isAccept(decision));
      if (!isAccept(decision)) return;

      const a = decision.value;
      assertEquals(
        a.policy.applyToSubprocess,
        true,
        "default Policy must opt in to subprocess inheritance per design 20 §E",
      );

      // Subprocess-side reads the same payload back. The round-trip is
      // the structural witness that the inheritance contract is honoured.
      const path = bootPolicyFilePath(tmp, a.runId);
      const inherited = await readBootPolicyFile(path);
      assertEquals(
        inherited.ghBinary,
        a.policy.ghBinary,
        "inherited Policy must preserve ghBinary so merge-pr respects parent",
      );
      assertEquals(
        inherited.transports.issueQuery,
        a.policy.transports.issueQuery,
        "inherited Policy must preserve transport polarity (R5 mode invariance)",
      );
      assertEquals(
        inherited.transports.close,
        a.policy.transports.close,
        "inherited Policy must preserve close transport polarity",
      );
      assertEquals(
        inherited.applyToSubprocess,
        true,
        "inherited Policy must preserve applyToSubprocess flag (idempotent)",
      );
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  },
);

Deno.test(
  "readBootPolicyFile — missing file surfaces a 'Layer-4 inheritance broken' error",
  async () => {
    const tmp = await Deno.makeTempDir();
    try {
      const missing = bootPolicyFilePath(tmp, "no-such-runid");
      let captured: Error | null = null;
      try {
        await readBootPolicyFile(missing);
      } catch (cause) {
        captured = cause instanceof Error ? cause : new Error(String(cause));
      }
      assert(
        captured !== null,
        "readBootPolicyFile must throw when the file is absent — silent " +
          "fallback would let merge-pr run with the wrong Policy (R5 violation)",
      );
      assert(
        captured!.message.includes("Layer-4 inheritance broken"),
        `error message must explain the inheritance contract; got: ` +
          `"${captured!.message}"`,
      );
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  },
);

Deno.test(
  "readBootPolicyFile — version mismatch is rejected explicitly",
  async () => {
    const tmp = await Deno.makeTempDir();
    try {
      await Deno.mkdir(`${tmp}/tmp`, { recursive: true });
      const path = `${tmp}/tmp/boot-policy-bad.json`;
      await Deno.writeTextFile(
        path,
        JSON.stringify({
          version: "999",
          runId: "bad",
          writtenAt: 0,
          policy: {
            storeWired: true,
            ghBinary: "gh",
            applyToSubprocess: true,
            transports: { issueQuery: "real", close: "real" },
          },
        }),
      );
      let captured: Error | null = null;
      try {
        await readBootPolicyFile(path);
      } catch (cause) {
        captured = cause instanceof Error ? cause : new Error(String(cause));
      }
      assert(
        captured !== null && captured.message.includes("version"),
        `version mismatch must surface a precise error; got: ` +
          `"${captured?.message ?? "(no error thrown)"}"`,
      );
    } finally {
      await Deno.remove(tmp, { recursive: true });
    }
  },
);
