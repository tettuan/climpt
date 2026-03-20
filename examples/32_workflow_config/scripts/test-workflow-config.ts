// deno-lint-ignore-file no-console
/**
 * test-workflow-config.ts
 *
 * Verifies loadWorkflow(): config loading, default application, and validation errors.
 *
 * Scenarios:
 * 1. Valid minimal config loads successfully
 * 2. Rules omitted -> defaults applied (maxCycles=5, cycleDelayMs=5000)
 * 3. Invalid phase type "inProgress" -> Error containing "invalid type"
 * 4. Empty labelMapping -> Error containing "must not be empty"
 * 5. maxCycles=0 -> Error containing ">= 1"
 */

import { join } from "@std/path";
import { loadWorkflow } from "../../../agents/orchestrator/workflow-loader.ts";

async function writeConfig(
  dir: string,
  config: Record<string, unknown>,
): Promise<void> {
  const agentDir = join(dir, ".agent");
  await Deno.mkdir(agentDir, { recursive: true });
  await Deno.writeTextFile(
    join(agentDir, "workflow.json"),
    JSON.stringify(config, null, 2),
  );
}

async function scenario1(): Promise<void> {
  console.log("Scenario 1: Valid minimal config loads successfully");
  const tmp = await Deno.makeTempDir();
  try {
    await writeConfig(tmp, {
      version: "1.0.0",
      phases: {
        implementation: { type: "actionable", priority: 1, agent: "iterator" },
        complete: { type: "terminal" },
      },
      labelMapping: { ready: "implementation", done: "complete" },
      agents: {
        iterator: {
          role: "transformer",
          outputPhase: "complete",
          fallbackPhase: "complete",
        },
      },
    });

    const config = await loadWorkflow(tmp);

    if (config.version !== "1.0.0") {
      throw new Error(`Expected version "1.0.0", got "${config.version}"`);
    }
    if (!config.phases.implementation) {
      throw new Error("Missing phases.implementation");
    }
    if (typeof config.rules.maxCycles !== "number") {
      throw new Error("rules.maxCycles is not a number");
    }

    console.log("Scenario 1: PASS");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
}

async function scenario2(): Promise<void> {
  console.log("Scenario 2: Rules omitted -> defaults applied");
  const tmp = await Deno.makeTempDir();
  try {
    await writeConfig(tmp, {
      version: "1.0.0",
      phases: {
        implementation: { type: "actionable", priority: 1, agent: "iterator" },
        complete: { type: "terminal" },
      },
      labelMapping: { ready: "implementation", done: "complete" },
      agents: {
        iterator: {
          role: "transformer",
          outputPhase: "complete",
          fallbackPhase: "complete",
        },
      },
      // rules intentionally omitted
    });

    const config = await loadWorkflow(tmp);

    if (config.rules.maxCycles !== 5) {
      throw new Error(
        `Expected maxCycles=5, got ${config.rules.maxCycles}`,
      );
    }
    if (config.rules.cycleDelayMs !== 5000) {
      throw new Error(
        `Expected cycleDelayMs=5000, got ${config.rules.cycleDelayMs}`,
      );
    }

    console.log("Scenario 2: PASS");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
}

async function scenario3(): Promise<void> {
  console.log('Scenario 3: Invalid phase type "inProgress" -> Error');
  const tmp = await Deno.makeTempDir();
  try {
    await writeConfig(tmp, {
      version: "1.0.0",
      phases: {
        implementation: { type: "inProgress", priority: 1, agent: "iterator" },
        complete: { type: "terminal" },
      },
      labelMapping: { ready: "implementation", done: "complete" },
      agents: {
        iterator: { role: "transformer", outputPhase: "complete" },
      },
    });

    let caught = false;
    try {
      await loadWorkflow(tmp);
    } catch (e) {
      caught = true;
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("invalid type")) {
        throw new Error(
          `Expected error containing 'invalid type', got: ${msg}`,
        );
      }
    }
    if (!caught) {
      throw new Error("Expected loadWorkflow to throw but it succeeded");
    }

    console.log("Scenario 3: PASS");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
}

async function scenario4(): Promise<void> {
  console.log("Scenario 4: Empty labelMapping -> Error");
  const tmp = await Deno.makeTempDir();
  try {
    await writeConfig(tmp, {
      version: "1.0.0",
      phases: { complete: { type: "terminal" } },
      labelMapping: {},
      agents: {},
    });

    let caught = false;
    try {
      await loadWorkflow(tmp);
    } catch (e) {
      caught = true;
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("must not be empty")) {
        throw new Error(
          `Expected error containing 'must not be empty', got: ${msg}`,
        );
      }
    }
    if (!caught) {
      throw new Error("Expected loadWorkflow to throw but it succeeded");
    }

    console.log("Scenario 4: PASS");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
}

async function scenario5(): Promise<void> {
  console.log("Scenario 5: maxCycles=0 -> Error");
  const tmp = await Deno.makeTempDir();
  try {
    await writeConfig(tmp, {
      version: "1.0.0",
      phases: {
        implementation: { type: "actionable", priority: 1, agent: "iterator" },
        complete: { type: "terminal" },
      },
      labelMapping: { ready: "implementation", done: "complete" },
      agents: {
        iterator: {
          role: "transformer",
          outputPhase: "complete",
          fallbackPhase: "complete",
        },
      },
      rules: { maxCycles: 0 },
    });

    let caught = false;
    try {
      await loadWorkflow(tmp);
    } catch (e) {
      caught = true;
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes(">= 1")) {
        throw new Error(
          `Expected error containing '>= 1', got: ${msg}`,
        );
      }
    }
    if (!caught) {
      throw new Error("Expected loadWorkflow to throw but it succeeded");
    }

    console.log("Scenario 5: PASS");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
}

async function main(): Promise<void> {
  await scenario1();
  await scenario2();
  await scenario3();
  await scenario4();
  await scenario5();
  console.log("\nSummary: all scenarios passed");
}

main();
