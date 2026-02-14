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
    behavior: {
      systemPromptPath: `${PATHS.PROMPTS_DIR}/system.md`,
      completionType: "keywordSignal",
      completionConfig: {
        completionKeyword: "TASK_COMPLETE",
      },
      allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      permissionMode: "acceptEdits",
    },
    parameters: {
      topic: {
        type: "string",
        description: "Topic for the session",
        required: true,
        cli: "--topic",
      },
    },
    prompts: {
      registry: PATHS.STEPS_REGISTRY,
      fallbackDir: `${PATHS.PROMPTS_DIR}/`,
    },
    actions: {
      enabled: false,
      types: [],
      outputFormat: "action",
    },
    github: {
      enabled: false,
    },
    worktree: {
      enabled: false,
    },
    logging: {
      directory: `tmp/logs/agents/${agentName}`,
      format: "jsonl",
      maxFiles: 50,
    },
  };

  await Deno.writeTextFile(
    join(agentDir, PATHS.AGENT_JSON),
    JSON.stringify(agentJson, null, 2),
  );

  // Create steps_registry.json
  // Format: Compatible with agents/prompts/resolver.ts (keywordSignal completion type)
  // For stepMachine completion type, use the scaffolder skill for advanced registry format
  const stepsRegistry = {
    version: "1.0.0",
    basePath: PATHS.PROMPTS_DIR,
    steps: {
      // System prompt: uses direct path
      system: {
        name: "System Prompt",
        path: "system.md",
        variables: ["uv-agent_name", "uv-completion_criteria"],
      },
      // Initial prompt: uses C3L path (c1/c2/c3)
      initial_manual: {
        name: "Manual Initial Prompt",
        c1: "steps",
        c2: STEP_PHASE.INITIAL,
        c3: "manual",
        edition: "default",
        variables: ["uv-topic", "uv-completion_keyword"],
      },
      // Continuation prompt: uses C3L path
      continuation_manual: {
        name: "Manual Continuation Prompt",
        c1: "steps",
        c2: STEP_PHASE.CONTINUATION,
        c3: "manual",
        edition: "default",
        variables: ["uv-iteration", "uv-completion_keyword"],
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

## Completion Criteria

{uv-completion_criteria}

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
