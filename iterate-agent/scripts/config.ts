/**
 * Iterate Agent - Configuration Loader
 *
 * Loads and validates configuration from iterate-agent/config.json.
 */

import { join } from "@std/path";
import type {
  AgentConfig,
  AgentName,
  IterateAgentConfig,
  UvVariables,
} from "./types.ts";

/**
 * Default configuration for iterate-agent
 */
const DEFAULT_CONFIG: IterateAgentConfig = {
  version: "1.0.0",
  agents: {
    climpt: {
      systemPromptTemplate: "iterate-agent/prompts/default.md",
      allowedTools: ["Skill", "Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      permissionMode: "acceptEdits",
    },
  },
  github: {
    apiVersion: "2022-11-28",
  },
  logging: {
    directory: "tmp/logs/agents",
    maxFiles: 100,
    format: "jsonl",
  },
};

/**
 * Default system prompt template
 */
const DEFAULT_PROMPT_TEMPLATE = `# Role
You are an autonomous agent working on continuous development.

# Objective
Execute development tasks autonomously and make continuous progress.

# Working Mode
- You are running in a perpetual execution cycle
- Use the **delegate-climpt-agent** Skill with --agent={{AGENT}} to execute development tasks
- After each task completion, ask Climpt for the next logical task via the Skill
- Your goal is to make continuous progress on {{COMPLETION_CRITERIA}}

# Task Execution Workflow
1. Receive current requirements/context
2. Invoke **delegate-climpt-agent** Skill with task description and --agent={{AGENT}}
3. Review the AI-generated summary from the sub-agent
4. Evaluate progress against completion criteria
5. If incomplete, ask Climpt (via Skill) what to do next
6. Repeat the cycle

# Completion Criteria
{{COMPLETION_CRITERIA_DETAIL}}

# Guidelines
- Be autonomous: Make decisions without waiting for human approval
- Be thorough: Ensure each task is properly completed before moving on
- Be organized: Maintain clear context of what has been done
- Be communicative: Provide clear status updates in your responses

## Guidelines for Development
- Prioritize functionality and code maintainability
- Follow the project's coding standards and patterns
- Write clear commit messages
- Ensure changes don't break existing functionality
- Consider edge cases and error handling
`;

/**
 * Load the main configuration file
 *
 * @param configPath - Path to config.json (defaults to iterate-agent/config.json)
 * @returns Parsed configuration
 * @throws Error if file doesn't exist or is invalid
 */
export async function loadConfig(
  configPath: string = "iterate-agent/config.json",
): Promise<IterateAgentConfig> {
  try {
    const content = await Deno.readTextFile(configPath);
    const config = JSON.parse(content) as IterateAgentConfig;

    // Validate config structure
    validateConfig(config);

    return config;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(
        `Configuration file not found: ${configPath}\n` +
          `Run initialization first: deno run -A jsr:@aidevtool/climpt/agents/iterator --init`,
      );
    }
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in configuration file: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Validate configuration structure
 *
 * @param config - Configuration to validate
 * @throws Error if validation fails
 */
function validateConfig(config: IterateAgentConfig): void {
  if (!config.version) {
    throw new Error("Configuration missing required field: version");
  }

  if (!config.agents || typeof config.agents !== "object") {
    throw new Error("Configuration missing or invalid field: agents");
  }

  if (!config.logging || !config.logging.directory) {
    throw new Error("Configuration missing required field: logging.directory");
  }

  // Validate each agent has required fields
  for (const [agentName, agentConfig] of Object.entries(config.agents)) {
    if (!agentConfig.systemPromptTemplate) {
      throw new Error(
        `Agent "${agentName}" missing required field: systemPromptTemplate`,
      );
    }
    if (!agentConfig.allowedTools || !Array.isArray(agentConfig.allowedTools)) {
      throw new Error(
        `Agent "${agentName}" missing or invalid field: allowedTools`,
      );
    }
    if (!agentConfig.permissionMode) {
      throw new Error(
        `Agent "${agentName}" missing required field: permissionMode`,
      );
    }
  }
}

/**
 * Get configuration for a specific agent
 *
 * @param config - Main configuration
 * @param agentName - MCP agent name
 * @returns Agent-specific configuration
 * @throws Error if agent doesn't exist
 */
export function getAgentConfig(
  config: IterateAgentConfig,
  agentName: AgentName,
): AgentConfig {
  const agentConfig = config.agents[agentName];

  if (!agentConfig) {
    throw new Error(
      `Agent "${agentName}" not found in configuration. Available agents: ${
        Object.keys(config.agents).join(", ")
      }`,
    );
  }

  return agentConfig;
}

/**
 * Load system prompt template for an agent
 *
 * @param agentConfig - Agent configuration
 * @param basePath - Base path for resolving template path (defaults to cwd)
 * @returns System prompt template content
 * @throws Error if template file doesn't exist
 */
export async function loadSystemPromptTemplate(
  agentConfig: AgentConfig,
  basePath: string = Deno.cwd(),
): Promise<string> {
  const templatePath = join(basePath, agentConfig.systemPromptTemplate);

  try {
    return await Deno.readTextFile(templatePath);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(
        `System prompt template not found: ${templatePath}\n` +
          `Run initialization first: deno run -A jsr:@aidevtool/climpt/agents/iterator --init`,
      );
    }
    throw error;
  }
}

/**
 * Ensure log directory exists
 *
 * @param config - Main configuration
 * @param agentName - MCP agent name
 * @returns Full path to log directory
 */
export async function ensureLogDirectory(
  config: IterateAgentConfig,
  agentName: AgentName,
): Promise<string> {
  const logDir = join(config.logging.directory, agentName);

  try {
    await Deno.mkdir(logDir, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.AlreadyExists)) {
      throw error;
    }
  }

  return logDir;
}

/**
 * Initialize configuration files in the current directory
 *
 * Creates:
 * - iterate-agent/config.json
 * - iterate-agent/prompts/default.md
 *
 * @param basePath - Base path for creating files (defaults to cwd)
 * @returns Object with paths of created files
 */
export async function initializeConfig(
  basePath: string = Deno.cwd(),
): Promise<{ configPath: string; promptPath: string }> {
  const configDir = join(basePath, "iterate-agent");
  const promptsDir = join(basePath, "iterate-agent/prompts");
  const configPath = join(configDir, "config.json");
  const promptPath = join(promptsDir, "default.md");

  // Check if config already exists
  try {
    await Deno.stat(configPath);
    throw new Error(
      `Configuration already exists: ${configPath}\n` +
        `Remove existing files first if you want to reinitialize.`,
    );
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
    // File doesn't exist, continue with initialization
  }

  // Create directories
  await Deno.mkdir(promptsDir, { recursive: true });

  // Write config.json
  await Deno.writeTextFile(
    configPath,
    JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n",
  );

  // Write default.md
  await Deno.writeTextFile(promptPath, DEFAULT_PROMPT_TEMPLATE);

  return { configPath, promptPath };
}

/**
 * Completion handler type to C3L mode mapping
 */
export type CompletionMode = "project" | "issue" | "iterate";

/**
 * Load system prompt via breakdown CLI
 *
 * Variable passing:
 * - --uv-agent_name, --uv-completion_criteria, --uv-target_label: CLI args
 * - completion_criteria_detail: STDIN (長文対応)
 *
 * @param mode - Completion mode (project, issue, or iterate)
 * @param uvVariables - UV variables for prompt expansion
 * @param stdinContent - Content to pass via STDIN (completion_criteria_detail)
 * @returns Expanded system prompt content
 * @throws Error if breakdown CLI fails or returns empty output
 */
export async function loadSystemPromptViaC3L(
  mode: CompletionMode,
  uvVariables: UvVariables,
  stdinContent: string,
): Promise<string> {
  // Map completion mode to C3L c3 value
  const c3 = mode === "iterate" ? "default" : mode;

  // Build CLI args
  const args = [
    "run",
    "--allow-read",
    "--allow-write",
    "--allow-env",
    "jsr:@aidevtool/climpt",
    "--config=iterator-dev",
    "start",
    c3,
  ];

  // Add uv- parameters (short strings only)
  for (const [key, value] of Object.entries(uvVariables)) {
    if (value !== undefined && value !== "") {
      args.push(`--uv-${key}=${value}`);
    }
  }

  const command = new Deno.Command("deno", {
    args,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });

  const process = command.spawn();

  // Write stdinContent (completion_criteria_detail) to STDIN
  const writer = process.stdin.getWriter();
  await writer.write(new TextEncoder().encode(stdinContent));
  await writer.close();

  const { stdout, stderr } = await process.output();
  const output = new TextDecoder().decode(stdout).trim();

  if (!output) {
    const errorOutput = new TextDecoder().decode(stderr);
    throw new Error(
      `Empty output from breakdown CLI.\n` +
        `Mode: ${mode}, Args: ${args.join(" ")}\n` +
        `Stderr: ${errorOutput}`,
    );
  }

  return output;
}
