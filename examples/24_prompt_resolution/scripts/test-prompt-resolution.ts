// deno-lint-ignore-file no-console
/**
 * test-prompt-resolution.ts
 *
 * Demonstrates how prompt file presence affects agent behavior.
 *
 * Scenarios:
 * 1. system.md with {uv-*} variables -> source="file", content from file
 * 2. system.md missing               -> source="fallback", generic template
 * 3. Step prompt file exists          -> source="file", content from file
 * 4. Step prompt file missing         -> source="fallback", embedded template
 */

import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { PromptResolverAdapter } from "../../../agents/prompts/resolver-adapter.ts";

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

async function setupTempAgent(agentName: string): Promise<string> {
  const agentDir = join(TMPDIR, `.agent/${agentName}`);
  await ensureDir(join(agentDir, "prompts"));

  // Minimal steps_registry.json
  const registry = {
    agentId: agentName,
    c1: "steps",
    userPromptsBase: `.agent/${agentName}/prompts`,
    steps: {
      "initial.issue": {
        stepId: "initial.issue",
        c2: "initial",
        c3: "issue",
        edition: "default",
        fallbackKey: "initial_issue",
        uvVariables: ["issue_number"],
        usesStdin: false,
      },
    },
  };
  await Deno.writeTextFile(
    join(agentDir, "steps_registry.json"),
    JSON.stringify(registry, null, 2),
  );

  return agentDir;
}

// ---------------------------------------------------------------------------
// Scenario 1 & 2: system.md with/without {uv-*}
// ---------------------------------------------------------------------------

async function scenarioSystemPrompt(agentDir: string): Promise<void> {
  const promptsDir = join(agentDir, "prompts");
  const systemPath = join(promptsDir, "system.md");

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

  const resolver1 = await PromptResolverAdapter.create({
    agentName: "example-agent",
    agentDir,
    registryPath: "steps_registry.json",
    systemPromptPath: "prompts/system.md",
  });

  const result1 = await resolver1.resolveSystemPromptWithMetadata({
    "uv-agent_name": "example-agent",
    "uv-completion_criteria": "Close issue when all tests pass",
  });

  printResult(result1);

  // --- Scenario 2: system.md MISSING ---
  header("Scenario 2: system.md MISSING (fallback)");
  console.log("  Removing system.md to trigger fallback...\n");

  await Deno.remove(systemPath);

  const resolver2 = await PromptResolverAdapter.create({
    agentName: "example-agent",
    agentDir,
    registryPath: "steps_registry.json",
    systemPromptPath: "prompts/system.md",
  });

  const result2 = await resolver2.resolveSystemPromptWithMetadata({
    "uv-agent_name": "example-agent",
    "uv-completion_criteria": "Close issue when all tests pass",
  });

  printResult(result2);

  // --- Comparison ---
  header("Comparison: system.md present vs absent");
  console.log(
    `  With file    -> source="${result1.source}", has custom instructions`,
  );
  console.log(
    `  Without file -> source="${result2.source}", generic fallback template`,
  );
  console.log(`  Content differs: ${result1.content !== result2.content}`);
}

// ---------------------------------------------------------------------------
// Scenario 3 & 4: Step prompt file with/without
// ---------------------------------------------------------------------------

async function scenarioStepPrompt(agentDir: string): Promise<void> {
  const promptsDir = join(agentDir, "prompts");

  // --- Scenario 3: Step prompt file EXISTS ---
  header("Scenario 3: Step prompt file EXISTS");

  const stepDir = join(promptsDir, "steps", "initial", "issue");
  await ensureDir(stepDir);

  console.log(
    "  Writing steps/initial/issue/f_default.md with {uv-issue_number}...\n",
  );

  await Deno.writeTextFile(
    join(stepDir, "f_default.md"),
    `---
description: Custom initial prompt for issue mode
---
# Issue #{uv-issue_number} - Start

You are beginning work on Issue #{uv-issue_number}.

## Custom Workflow
1. Read the issue description carefully
2. Create a branch: feature/issue-{uv-issue_number}
3. Write failing tests first
4. Implement the solution
5. Run CI before marking done
`,
  );

  // When step prompt file exists, the resolver tries breakdown (C3L) first.
  // Since breakdown requires the full CLI, we demonstrate the concept by
  // showing the file content with manual variable substitution.
  const content = await Deno.readTextFile(join(stepDir, "f_default.md"));

  // Simulate what the resolver does: strip frontmatter, substitute variables
  const stripped = content.replace(/^---[\s\S]*?---\n/, "").trim();
  const substituted = stripped.replace(/\{uv-issue_number\}/g, "42");

  console.log(`  source     : user (from file)`);
  console.log(`  promptPath : steps/initial/issue/f_default.md`);
  console.log(`  content    :`);
  for (const line of substituted.split("\n").slice(0, 8)) {
    console.log(`    ${line}`);
  }

  // --- Scenario 4: Step prompt file MISSING ---
  header("Scenario 4: Step prompt file MISSING (fallback)");
  console.log("  Removing step prompt file to trigger fallback...\n");

  await Deno.remove(join(stepDir, "f_default.md"));

  // Show what the fallback template looks like
  const fallbackTemplate = `# GitHub Issue #42

Work on completing the requirements in Issue #42.

Review the issue, understand the requirements, and begin implementation.

When all requirements are satisfied, close the issue using \`gh issue close 42\`.`;

  console.log(`  source     : fallback (embedded template)`);
  console.log(`  promptPath : (none)`);
  console.log(`  content    :`);
  for (const line of fallbackTemplate.split("\n").slice(0, 8)) {
    console.log(`    ${line}`);
  }

  // --- Comparison ---
  header("Comparison: Step prompt present vs absent");
  console.log(
    '  With file    -> source="user", custom workflow (TDD, branch naming)',
  );
  console.log('  Without file -> source="fallback", generic issue template');
  console.log(
    "  The user file controls agent behavior via prompt instructions.",
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
  const agentDir = await setupTempAgent("example-agent");

  try {
    await scenarioSystemPrompt(agentDir);
    await scenarioStepPrompt(agentDir);

    header("Summary");
    console.log(`
  Prompt resolution follows a two-tier strategy:

    1. Try user file  -> .agent/{name}/prompts/system.md
                         .agent/{name}/prompts/steps/{c2}/{c3}/f_{edition}.md
    2. Fall back      -> Embedded template (DefaultFallbackProvider)

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
