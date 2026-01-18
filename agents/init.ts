/**
 * Agent initialization - creates new agent templates
 */

import { join } from "@std/path";
import { ensureDir } from "@std/fs";

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

  const agentDir = join(cwd, ".agent", agentName);

  // Check if agent already exists
  try {
    await Deno.stat(join(agentDir, "agent.json"));
    throw new Error(`Agent '${agentName}' already exists at ${agentDir}`);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }

  // Create directory structure
  await ensureDir(agentDir);
  await ensureDir(join(agentDir, "prompts"));
  await ensureDir(join(agentDir, "prompts", "steps", "initial", "manual"));
  await ensureDir(join(agentDir, "prompts", "steps", "continuation", "manual"));

  // Create agent.json
  const agentJson = {
    $schema:
      "https://raw.githubusercontent.com/tettuan/climpt-agents/main/schemas/agent.schema.json",
    version: "1.0.0",
    name: agentName,
    displayName: formatDisplayName(agentName),
    description: `${formatDisplayName(agentName)} agent`,
    behavior: {
      systemPromptPath: "prompts/system.md",
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
      registry: "steps_registry.json",
      fallbackDir: "prompts/",
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
    join(agentDir, "agent.json"),
    JSON.stringify(agentJson, null, 2),
  );

  // Create steps_registry.json
  const stepsRegistry = {
    version: "1.0.0",
    basePath: "prompts",
    steps: {
      system: {
        name: "System Prompt",
        path: "system.md",
        variables: ["uv-agent_name", "uv-completion_criteria"],
      },
      initial_manual: {
        name: "Manual Initial Prompt",
        c1: "steps",
        c2: "initial",
        c3: "manual",
        edition: "default",
        variables: ["uv-topic", "uv-completion_keyword"],
      },
      continuation_manual: {
        name: "Manual Continuation Prompt",
        c1: "steps",
        c2: "continuation",
        c3: "manual",
        edition: "default",
        variables: ["uv-iteration", "uv-completion_keyword"],
      },
    },
    editions: {
      default: "Standard",
    },
  };

  await Deno.writeTextFile(
    join(agentDir, "steps_registry.json"),
    JSON.stringify(stepsRegistry, null, 2),
  );

  // Create system.md
  const systemPrompt = `# ${formatDisplayName(agentName)} Agent

You are operating as the **${agentName}** agent.

## Completion Criteria

{{uv-completion_criteria}}

## Guidelines

- Think step by step
- Report progress regularly
- Ask for clarification when needed
- Follow the completion criteria closely
`;

  await Deno.writeTextFile(
    join(agentDir, "prompts", "system.md"),
    systemPrompt,
  );

  // Create initial prompt
  const initialPrompt = `# Session Start

## Topic
{{uv-topic}}

---

Begin the session. When complete, output \`{{uv-completion_keyword}}\`.
`;

  await Deno.writeTextFile(
    join(agentDir, "prompts", "steps", "initial", "manual", "f_default.md"),
    initialPrompt,
  );

  // Create continuation prompt
  const continuationPrompt = `# Continuation (Iteration {{uv-iteration}})

Continue working on the task.

When complete, output \`{{uv-completion_keyword}}\`.
`;

  await Deno.writeTextFile(
    join(
      agentDir,
      "prompts",
      "steps",
      "continuation",
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
  console.log(`  - ${join(agentDir, "agent.json")}`);
  // deno-lint-ignore no-console
  console.log(`  - ${join(agentDir, "steps_registry.json")}`);
  // deno-lint-ignore no-console
  console.log(`  - ${join(agentDir, "prompts", "system.md")}`);
  // deno-lint-ignore no-console
  console.log(
    `  - ${
      join(agentDir, "prompts", "steps", "initial", "manual", "f_default.md")
    }`,
  );
  // deno-lint-ignore no-console
  console.log(
    `  - ${
      join(
        agentDir,
        "prompts",
        "steps",
        "continuation",
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
