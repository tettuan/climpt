// deno-lint-ignore-file no-console
/**
 * test-prompt-resolution.ts
 *
 * Demonstrates how prompt file presence affects agent behavior.
 *
 * Scenarios:
 * 1. system.md with {uv-*} variables -> source="file", content from file
 * 2. system.md missing               -> source="fallback", generic template
 * 3. Step prompt file exists          -> source="user", content from file
 * 4. Step prompt file missing         -> throws PR-C3L-004 error
 */

import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { PromptResolver } from "../../../agents/common/prompt-resolver.ts";
import {
  addStepDefinition,
  createEmptyRegistry,
} from "../../../agents/common/step-registry.ts";
import { resolveSystemPrompt } from "../../../agents/prompts/system-prompt.ts";
import type { StepRegistry } from "../../../agents/common/step-registry.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SEPARATOR = "-".repeat(60);
const TMPDIR = join(Deno.cwd(), "tmp", "prompt-resolution-example");

function header(title: string): void {
  console.log(`\n${SEPARATOR}`);
  console.log(`  ${title}`);
  console.log(SEPARATOR);
}

function printResult(
  result: { content: string; source: string; promptPath?: string },
): void {
  console.log(`  source     : ${result.source}`);
  console.log(`  promptPath : ${result.promptPath ?? "(none)"}`);
  console.log(`  content    :`);
  const lines = result.content.split("\n").slice(0, 8);
  for (const line of lines) {
    console.log(`    ${line}`);
  }
  if (result.content.split("\n").length > 8) {
    console.log(`    ... (truncated)`);
  }
}

// ---------------------------------------------------------------------------
// Setup temporary agent directory
// ---------------------------------------------------------------------------

async function setupTempAgent(
  agentName: string,
): Promise<{ agentDir: string; registry: StepRegistry }> {
  const agentDir = join(TMPDIR, `.agent/${agentName}`);
  await ensureDir(join(agentDir, "prompts"));

  // Create breakdown config files required by C3LPromptLoader / runBreakdown
  const configDir = join(TMPDIR, ".agent/climpt/config");
  await ensureDir(configDir);

  // -app.yml: tells breakdown where to find prompts
  await Deno.writeTextFile(
    join(configDir, `${agentName}-steps-app.yml`),
    `working_dir: ".agent/${agentName}"
app_prompt:
  base_dir: "prompts/steps"
app_schema:
  base_dir: "schema/steps"
`,
  );

  // -user.yml: validates c2/c3 parameter patterns
  await Deno.writeTextFile(
    join(configDir, `${agentName}-steps-user.yml`),
    `params:
  two:
    directiveType:
      pattern: "^(initial|continuation)$"
    layerType:
      pattern: "^(issue)$"
`,
  );

  // Build StepRegistry in-memory
  const registry = createEmptyRegistry(agentName, "steps", "1.0.0");
  registry.userPromptsBase = `.agent/${agentName}/prompts`;
  registry.entryStep = "initial.issue";

  addStepDefinition(registry, {
    stepId: "initial.issue",
    name: "Issue Initial Prompt",
    stepKind: "work",
    c2: "initial",
    c3: "issue",
    edition: "default",
    uvVariables: ["issue"],
    usesStdin: false,
  });

  return { agentDir, registry };
}

// ---------------------------------------------------------------------------
// Scenario 1 & 2: system.md with/without {uv-*}
// ---------------------------------------------------------------------------

async function scenarioSystemPrompt(agentDir: string): Promise<void> {
  const promptsDir = join(agentDir, "prompts");
  const systemPath = join(promptsDir, "system.md");

  const systemVars: Record<string, string> = {
    "uv-agent_name": "example-agent",
    "uv-completion_criteria": "Close issue when all tests pass",
  };

  // --- Scenario 1: system.md EXISTS with {uv-*} ---
  header("Scenario 1: system.md EXISTS with {uv-*} variables");
  console.log(
    "  Writing system.md with {uv-agent_name} and {uv-completion_criteria}...\n",
  );

  await Deno.writeTextFile(
    systemPath,
    `# {uv-agent_name} Agent

You are the **{uv-agent_name}** implementation agent.

## Completion Criteria
{uv-completion_criteria}

## Custom Instructions
- Follow TDD approach
- Write tests before implementation
- Use sub-agents for complex research
`,
  );

  const raw1 = await resolveSystemPrompt({
    agentDir,
    systemPromptPath: "prompts/system.md",
    variables: systemVars,
  });
  const result1 = {
    content: raw1.content,
    source: raw1.source,
    promptPath: raw1.path,
  };

  printResult(result1);

  // --- Scenario 2: system.md MISSING (throws PR-SYSTEM-002) ---
  header("Scenario 2: system.md MISSING (throws PR-SYSTEM-002)");
  console.log("  Removing system.md to trigger error...\n");

  await Deno.remove(systemPath);

  let scenario2Error: string | null = null;
  try {
    await resolveSystemPrompt({
      agentDir,
      systemPromptPath: "prompts/system.md",
      variables: systemVars,
    });
    console.log("  FAIL: Expected PR-SYSTEM-002 but resolve succeeded");
  } catch (e: unknown) {
    scenario2Error = e instanceof Error ? e.message : String(e);
    console.log(`  Correctly threw: ${scenario2Error}`);
  }

  // --- Comparison ---
  header("Comparison: system.md present vs absent");
  console.log(
    `  With file    -> source="${result1.source}", has custom instructions`,
  );
  console.log(
    `  Without file -> throws PR-SYSTEM-002 (C3L-only, no fallback)`,
  );
  if (scenario2Error && !scenario2Error.includes("PR-SYSTEM-002")) {
    console.log(`  FAIL: expected PR-SYSTEM-002 but got: ${scenario2Error}`);
  }
}

// ---------------------------------------------------------------------------
// Scenario 3 & 4: Step prompt file with/without
// ---------------------------------------------------------------------------

async function scenarioStepPrompt(
  agentDir: string,
  registry: StepRegistry,
): Promise<void> {
  const promptsDir = join(agentDir, "prompts");

  // --- Scenario 3: Step prompt file EXISTS ---
  header("Scenario 3: Step prompt file EXISTS");

  const stepDir = join(promptsDir, "steps", "initial", "issue");
  await ensureDir(stepDir);

  console.log(
    "  Writing steps/initial/issue/f_default.md with {uv-issue}...\n",
  );

  await Deno.writeTextFile(
    join(stepDir, "f_default.md"),
    `---
description: Custom initial prompt for issue mode
---
# Issue #{uv-issue} - Start

You are beginning work on Issue #{uv-issue}.

## Custom Workflow
1. Read the issue description carefully
2. Create a branch: feature/issue-{uv-issue}
3. Write failing tests first
4. Implement the solution
5. Run CI before marking done
`,
  );

  const resolver3 = new PromptResolver(registry, {
    workingDir: TMPDIR,
    allowMissingVariables: true,
  });

  const result3 = await resolver3.resolve("initial.issue", {
    uv: { issue: "42" },
  });

  printResult(result3);

  // --- Scenario 4: Step prompt file MISSING (throws) ---
  header("Scenario 4: Step prompt file MISSING (throws PR-C3L-004)");
  console.log("  Removing step prompt file to trigger error...\n");

  await Deno.remove(join(stepDir, "f_default.md"));

  const resolver4 = new PromptResolver(registry, {
    workingDir: TMPDIR,
    allowMissingVariables: true,
  });

  try {
    await resolver4.resolve("initial.issue", {
      uv: { issue: "42" },
    });
    console.log("  ERROR: Expected PR-C3L-004 but resolve succeeded");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`  Correctly threw: ${msg}`);
  }

  // --- Comparison ---
  header("Comparison: Step prompt present vs absent");
  console.log(
    `  With file    -> source="${result3.source}", content from C3L prompt`,
  );
  console.log(
    `  Without file -> throws PR-C3L-004 (no fallback)`,
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("============================================================");
  console.log("  Prompt Resolution: File Presence Affects Agent Behavior");
  console.log("============================================================");

  // Setup
  await ensureDir(TMPDIR);
  const { agentDir, registry } = await setupTempAgent("example-agent");

  try {
    await scenarioSystemPrompt(agentDir);
    await scenarioStepPrompt(agentDir, registry);

    header("Summary");
    console.log(`
  Prompt resolution follows a two-tier strategy:

    System prompts (C3L-only):
      1. Try user file  -> .agent/{name}/prompts/system.md
      2. No fallback    -> Throws PR-SYSTEM-002 error

    Step prompts (C3L-only):
      1. Try C3L file   -> .agent/{name}/prompts/{c1}/{c2}/{c3}/f_{edition}.md
      2. No fallback    -> Throws PR-C3L-004 error

  When {uv-*} variables appear in your prompt files, they are
  substituted with runtime values (agent name, issue number, etc.).

  To customize agent behavior:
    - Create/edit system.md with role-specific instructions
    - Create step prompt files for workflow-specific guidance
    - Use {uv-*} placeholders for dynamic values

  To verify: compare "source" field in prompt resolution logs.
`);
  } finally {
    // Cleanup
    await Deno.remove(TMPDIR, { recursive: true });
  }
}

main();
