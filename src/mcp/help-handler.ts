/**
 * @fileoverview Help protocol handler for MCP server
 * @module mcp/help-handler
 *
 * Dispatches describe / scaffold / validate actions against the static help graph,
 * wiring scaffold to initAgent() and validate to validateFull().
 *
 * @see docs/internal/unified-help-concept.md
 */

import type {
  HelpDescribeResult,
  HelpProtocol,
  HelpResult,
  HelpScaffoldResult,
  HelpValidateResult,
  HelpViolation,
} from "./help-types.ts";
import { DETAIL_NODES, HELP_PROTOCOL, ROOT_NODE } from "./help-graph.ts";
import { initAgent } from "../../agents/init.ts";
import {
  type FullValidationResult,
  validateFull,
} from "../../agents/config/mod.ts";
import { logger } from "../utils/logger.ts";

/** Help tool input parameters */
export interface HelpInput {
  action: "describe" | "scaffold" | "validate";
  id?: string;
  params?: Record<string, string>;
}

/**
 * Handle a help protocol request.
 *
 * @param input - Action, optional node ID, and optional parameters
 * @returns Help result (describe, scaffold, or validate response)
 */
export async function handleHelp(
  input: HelpInput,
): Promise<{ result: HelpResult; _protocol?: HelpProtocol }> {
  const { action, id, params } = input;
  logger.info(`[HELP] ${action}(${id ?? "root"})`);

  switch (action) {
    case "describe":
      return handleDescribe(id);
    case "scaffold":
      return { result: await handleScaffold(id, params) };
    case "validate":
      return { result: await handleValidate(id, params) };
    default:
      throw new Error(`Unknown help action: ${action}`);
  }
}

/**
 * describe() — returns node structure with edges, build spec, and constraints.
 * Root describe (no id) includes _protocol metadata and 2-tier children.
 */
function handleDescribe(
  id?: string,
): { result: HelpDescribeResult; _protocol?: HelpProtocol } {
  if (!id) {
    // Root describe: return full root node with protocol
    return {
      result: {
        action: "describe",
        target: "climpt",
        result: ROOT_NODE,
      },
      _protocol: HELP_PROTOCOL,
    };
  }

  // Detail describe: look up in detail nodes, then fall back to root children
  const detailNode = DETAIL_NODES[id];
  if (detailNode) {
    return {
      result: {
        action: "describe",
        target: id,
        result: detailNode,
      },
    };
  }

  // Check root children for basic nodes without full constraints
  const childNode = ROOT_NODE.children?.find((c) => c.id === id);
  if (childNode) {
    return {
      result: {
        action: "describe",
        target: id,
        result: childNode,
      },
    };
  }

  throw new Error(
    `Unknown node: ${id}. Valid targets: ${
      ROOT_NODE.edges.map((e) => e.target).join(", ")
    }`,
  );
}

/**
 * scaffold() — creates files via initAgent() and returns created paths.
 */
async function handleScaffold(
  target?: string,
  params?: Record<string, string>,
): Promise<HelpScaffoldResult> {
  if (!target) {
    throw new Error("scaffold requires a target (e.g., 'agent', 'prompt')");
  }

  const name = params?.name;
  if (!name) {
    throw new Error("scaffold requires params.name");
  }

  if (target === "agent") {
    const cwd = Deno.cwd();
    await initAgent(name, cwd);

    return {
      action: "scaffold",
      target,
      params: { name },
      result: {
        command: `deno task agent --init --agent ${name}`,
        params: { name },
        examples: [`deno task agent --init --agent ${name}`],
        created: [
          `.agent/${name}/agent.json`,
          `.agent/${name}/steps_registry.json`,
          `.agent/${name}/prompts/system.md`,
          `.agent/${name}/prompts/steps/initial/manual/f_default.md`,
          `.agent/${name}/prompts/steps/continuation/manual/f_default.md`,
        ],
        next: {
          action: "validate",
          target: "agent",
          params: { name },
        },
      },
    };
  }

  // Prompt and orchestrator scaffold are not yet implemented
  throw new Error(
    `scaffold for '${target}' is not yet implemented. Currently supported: agent`,
  );
}

/**
 * Map a FullValidationResult to help protocol constraint rule IDs.
 */
function mapValidationToRules(
  result: FullValidationResult,
): { passed: string[]; violations: HelpViolation[] } {
  const passed: string[] = [];
  const violations: HelpViolation[] = [];

  // Map validation layers to constraint rules
  if (result.agentSchemaResult.valid) {
    passed.push("R-A1", "R-A3");
  } else {
    for (const err of result.agentSchemaResult.errors) {
      violations.push({
        rule: "R-A1",
        message: err.message,
        fix: `Fix agent.json at ${err.path}`,
      });
    }
  }

  if (result.agentConfigResult.valid) {
    passed.push("R-A2");
  } else {
    for (const err of result.agentConfigResult.errors) {
      violations.push({
        rule: "R-A2",
        message: err,
        fix: "Ensure all declared parameters are consumed by at least one step",
      });
    }
  }

  if (result.crossRefResult?.valid) {
    passed.push("R-B1", "R-B5");
  } else if (result.crossRefResult) {
    for (const err of result.crossRefResult.errors) {
      violations.push({
        rule: "R-B1",
        message: err,
        fix:
          "Fix step key/stepId mismatch or invalid transition target in steps_registry.json",
      });
    }
  }

  if (result.pathResult?.valid) {
    passed.push("R-D1", "PATH-1");
  } else if (result.pathResult) {
    for (const err of result.pathResult.errors) {
      violations.push({
        rule: "R-D1",
        message: err,
        fix: "Ensure referenced files exist on disk",
      });
    }
  }

  if (result.registrySchemaResult?.valid) {
    passed.push("R-D2", "R-D3");
  } else if (result.registrySchemaResult) {
    for (const err of result.registrySchemaResult.errors) {
      violations.push({
        rule: "R-D2",
        message: err.message,
        fix: `Fix schema reference at ${err.path}`,
      });
    }
  }

  if (result.templateUvResult?.valid) {
    passed.push("TEMPLATE-1", "TEMPLATE-2");
  } else if (result.templateUvResult) {
    for (const err of result.templateUvResult.errors) {
      violations.push({
        rule: "TEMPLATE-1",
        message: err,
        fix: "Ensure prompt template variables match step uvVariables",
      });
    }
  }

  return { passed, violations };
}

/**
 * validate() — runs validateFull() and maps results to help protocol format.
 */
async function handleValidate(
  target?: string,
  params?: Record<string, string>,
): Promise<HelpValidateResult> {
  if (!target) {
    throw new Error("validate requires a target");
  }

  const name = params?.name;
  if (!name) {
    throw new Error("validate requires params.name");
  }

  if (target === "agent") {
    const cwd = Deno.cwd();
    const fullResult = await validateFull(name, cwd);
    const { passed, violations } = mapValidationToRules(fullResult);

    const result: HelpValidateResult = {
      action: "validate",
      target,
      params: { name },
      result: {
        passed,
        violations,
      },
    };

    // Only reveal run when all validations pass
    if (fullResult.valid) {
      result.result.run = {
        command: `deno task agent --agent ${name}`,
        endpoint: "@aidevtool/climpt/agents/runner",
        params: {
          name: "Agent name",
          "--issue": "GitHub Issue number",
        },
        examples: [
          `deno task agent --agent ${name} --issue 42`,
        ],
      };
    }

    return result;
  }

  throw new Error(
    `validate for '${target}' is not yet implemented. Currently supported: agent`,
  );
}
