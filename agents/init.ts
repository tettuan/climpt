/**
 * Agent initialization - creates new agent templates
 */

import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { PATHS } from "./shared/paths.ts";
import { STEP_PHASE } from "./shared/step-phases.ts";

/**
 * Initialize a new agent with template files
 */
export async function initAgent(
  agentName: string,
  cwd: string = Deno.cwd(),
): Promise<void> {
  if (!agentName) {
    throw new Error("Agent name is required");
  }

  // Validate agent name
  if (!/^[a-z][a-z0-9-]*$/.test(agentName)) {
    throw new Error(
      "Agent name must be lowercase kebab-case (e.g., 'my-agent')",
    );
  }

  const agentDir = join(cwd, PATHS.AGENT_DIR_PREFIX, agentName);

  // Check if agent already exists
  try {
    await Deno.stat(join(agentDir, PATHS.AGENT_JSON));
    throw new Error(`Agent '${agentName}' already exists at ${agentDir}`);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }

  // Create directory structure
  await ensureDir(agentDir);
  await ensureDir(join(agentDir, PATHS.PROMPTS_DIR));
  await ensureDir(
    join(agentDir, PATHS.PROMPTS_DIR, "steps", STEP_PHASE.INITIAL, "manual"),
  );
  await ensureDir(
    join(
      agentDir,
      PATHS.PROMPTS_DIR,
      "steps",
      STEP_PHASE.CONTINUATION,
      "manual",
    ),
  );

  // Create agent.json
  // Note: $schema uses relative path from .agent/{name}/ to project root
  const agentJson = {
    $schema: "../../agents/schemas/agent.schema.json",
    version: "1.0.0",
    name: agentName,
    displayName: formatDisplayName(agentName),
    description: `${formatDisplayName(agentName)} agent`,
    parameters: {
      topic: {
        type: "string",
        description: "Topic for the session",
        required: true,
        cli: "--topic",
      },
      maxIterations: {
        type: "number",
        description: "Maximum iterations",
        default: 10,
        cli: "--max-iterations",
      },
    },
    runner: {
      flow: {
        systemPromptPath: `${PATHS.PROMPTS_DIR}/system.md`,
        prompts: {
          registry: PATHS.STEPS_REGISTRY,
          fallbackDir: `${PATHS.PROMPTS_DIR}/`,
        },
      },
      verdict: {
        type: "detect:keyword",
        config: {
          verdictKeyword: "TASK_COMPLETE",
        },
      },
      boundaries: {
        allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
        permissionMode: "acceptEdits",
      },
      integrations: {
        github: {
          enabled: false,
        },
      },
      actions: {
        enabled: false,
        types: [],
        outputFormat: "action",
      },
      execution: {
        worktree: {
          enabled: false,
        },
      },
      logging: {
        directory: `tmp/logs/agents/${agentName}`,
        format: "jsonl",
        maxFiles: 50,
      },
    },
  };

  await Deno.writeTextFile(
    join(agentDir, PATHS.AGENT_JSON),
    JSON.stringify(agentJson, null, 2),
  );

  // Create steps_registry.json
  // Format: Compatible with agents/prompts/resolver.ts (keywordSignal verdict type)
  // For stepMachine verdict type, use the scaffolder skill for advanced registry format
  const stepsRegistry = {
    agentId: agentName,
    version: "1.0.0",
    c1: "steps",
    entryStepMapping: {
      "detect:keyword": `${STEP_PHASE.INITIAL}.manual`,
    },
    steps: {
      // System prompt: variable tracking only (resolution via flow.systemPromptPath)
      system: {
        stepId: "system",
        name: "System Prompt",
        c2: "system",
        c3: "prompt",
        edition: "default",
        fallbackKey: "system_prompt",
        uvVariables: ["uv-agent_name", "uv-verdict_criteria"],
        usesStdin: false,
      },
      // Initial prompt: uses C3L path (c1/c2/c3)
      [`${STEP_PHASE.INITIAL}.manual`]: {
        stepId: `${STEP_PHASE.INITIAL}.manual`,
        name: "Manual Initial Prompt",
        c2: STEP_PHASE.INITIAL,
        c3: "manual",
        edition: "default",
        stepKind: "work",
        fallbackKey: "initial_manual",
        uvVariables: ["uv-topic", "uv-completion_keyword"],
        usesStdin: false,
        transitions: {
          next: {
            target: `${STEP_PHASE.CONTINUATION}.manual`,
          },
        },
      },
      // Continuation prompt: uses C3L path
      [`${STEP_PHASE.CONTINUATION}.manual`]: {
        stepId: `${STEP_PHASE.CONTINUATION}.manual`,
        name: "Manual Continuation Prompt",
        c2: STEP_PHASE.CONTINUATION,
        c3: "manual",
        edition: "default",
        stepKind: "work",
        fallbackKey: "continuation_manual",
        uvVariables: ["uv-iteration", "uv-completion_keyword"],
        usesStdin: false,
        transitions: {
          next: {
            target: `${STEP_PHASE.CONTINUATION}.manual`,
          },
        },
      },
    },
  };

  await Deno.writeTextFile(
    join(agentDir, PATHS.STEPS_REGISTRY),
    JSON.stringify(stepsRegistry, null, 2),
  );

  // Create system.md
  const systemPrompt = `# ${formatDisplayName(agentName)} Agent

You are operating as the **${agentName}** agent.

## Verdict Criteria

{uv-verdict_criteria}

## Guidelines

- Think step by step
- Report progress regularly
- Ask for clarification when needed
- Follow the completion criteria closely
`;

  await Deno.writeTextFile(
    join(agentDir, PATHS.PROMPTS_DIR, "system.md"),
    systemPrompt,
  );

  // Create initial prompt
  const initialPrompt = `# Session Start

## Topic
{uv-topic}

---

Begin the session. When complete, output \`{uv-completion_keyword}\`.
`;

  await Deno.writeTextFile(
    join(
      agentDir,
      PATHS.PROMPTS_DIR,
      "steps",
      STEP_PHASE.INITIAL,
      "manual",
      "f_default.md",
    ),
    initialPrompt,
  );

  // Create continuation prompt
  const continuationPrompt = `# Continuation (Iteration {uv-iteration})

Continue working on the task.

When complete, output \`{uv-completion_keyword}\`.
`;

  await Deno.writeTextFile(
    join(
      agentDir,
      PATHS.PROMPTS_DIR,
      "steps",
      STEP_PHASE.CONTINUATION,
      "manual",
      "f_default.md",
    ),
    continuationPrompt,
  );

  // Create breakdown configuration files for C3L prompt resolution
  // Naming convention: {agentId}-{c1}-app.yml / {agentId}-{c1}-user.yml
  //   agentId = agent name (e.g., "plan-scout")
  //   c1      = steps_registry.json c1 field (usually "steps")
  // See: agents/CLAUDE.md "Breakdown Config Naming Convention"
  // See: agents/common/c3l-prompt-loader.ts (configName construction)
  const configDir = join(cwd, PATHS.AGENT_DIR_PREFIX, "climpt", "config");
  await ensureDir(configDir);

  const appYmlPath = join(configDir, `${agentName}-steps-app.yml`);
  const appYmlContent = `# Build Configuration for ${agentName}-steps
working_dir: ".agent/${agentName}"
app_prompt:
  base_dir: "prompts/steps"
app_schema:
  base_dir: "schema/steps"
`;
  await Deno.writeTextFile(appYmlPath, appYmlContent);

  const userYmlPath = join(configDir, `${agentName}-steps-user.yml`);
  const userYmlContent = `# Breakdown Configuration for ${agentName}-steps
params:
  two:
    directiveType:
      pattern: "^(initial|continuation)$"
    layerType:
      pattern: "^(manual)$"
`;
  await Deno.writeTextFile(userYmlPath, userYmlContent);

  // deno-lint-ignore no-console
  console.log(`Agent '${agentName}' initialized at ${agentDir}`);
  // deno-lint-ignore no-console
  console.log("\nFiles created:");
  // deno-lint-ignore no-console
  console.log(`  - ${join(agentDir, PATHS.AGENT_JSON)}`);
  // deno-lint-ignore no-console
  console.log(`  - ${join(agentDir, PATHS.STEPS_REGISTRY)}`);
  // deno-lint-ignore no-console
  console.log(`  - ${join(agentDir, PATHS.PROMPTS_DIR, "system.md")}`);
  // deno-lint-ignore no-console
  console.log(
    `  - ${
      join(
        agentDir,
        PATHS.PROMPTS_DIR,
        "steps",
        STEP_PHASE.INITIAL,
        "manual",
        "f_default.md",
      )
    }`,
  );
  // deno-lint-ignore no-console
  console.log(
    `  - ${
      join(
        agentDir,
        PATHS.PROMPTS_DIR,
        "steps",
        STEP_PHASE.CONTINUATION,
        "manual",
        "f_default.md",
      )
    }`,
  );
  // deno-lint-ignore no-console
  console.log(`  - ${appYmlPath}`);
  // deno-lint-ignore no-console
  console.log(`  - ${userYmlPath}`);
  // deno-lint-ignore no-console
  console.log(
    `\nRun with: deno task agent --agent ${agentName} --topic "Your topic"`,
  );
}

function formatDisplayName(name: string): string {
  return name
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
