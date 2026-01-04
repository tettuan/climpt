/**
 * Review Agent - Configuration Module
 *
 * Loads configuration with the following priority:
 * 1. User config from .agent/reviewer/config.json (if exists)
 * 2. Package default config (bundled via import)
 */

import { join } from "@std/path";
import type {
  AgentConfig,
  AgentName,
  ReviewAgentConfig,
  UvVariables,
} from "./types.ts";
import BUNDLED_CONFIG from "../config.json" with { type: "json" };

/**
 * User config file path (relative to CWD)
 */
const USER_CONFIG_PATH = ".agent/reviewer/config.json";

/**
 * Default configuration template
 */
const DEFAULT_CONFIG: ReviewAgentConfig = {
  version: "1.0.0",
  agents: {
    reviewer: {
      systemPromptTemplate: "agents/reviewer/prompts/default.md",
      allowedTools: ["Skill", "Read", "Glob", "Grep", "Bash", "WebFetch"],
      permissionMode: "plan",
    },
  },
  requiredParams: {
    project: {
      type: "string",
      description: "GitHub Project name containing requirements",
      required: true,
    },
    issue: {
      type: "number",
      description: "Issue number to review implementation against",
      required: true,
    },
  },
  github: {
    apiVersion: "2022-11-28",
    tokenEnvVar: "GITHUB_TOKEN",
    labels: {
      gap: "implementation-gap",
      reviewer: "from-reviewer",
    },
  },
  logging: {
    directory: "tmp/logs/review-agent",
    maxFiles: 100,
    format: "jsonl",
  },
  output: {
    issueLabels: ["implementation-gap", "from-reviewer"],
  },
};

/**
 * Default system prompt template
 */
const DEFAULT_PROMPT_TEMPLATE = `# Role

You are an autonomous review agent that verifies implementation against requirements.

# Objective

Analyze implementation completeness against specified requirements and create issues for any gaps.

# Required Context

- Project: {{PROJECT}}
- Issue: {{ISSUE}}
- Requirements from: tettuan/{{PROJECT}}-docs

# Working Mode

1. **Requirement Fetch**: Retrieve requirements from the specified issue
2. **Implementation Analysis**: Examine current codebase against requirements
3. **Gap Identification**: Identify missing or incomplete implementations
4. **Issue Creation**: Create detailed issues for each gap found

# Review Workflow

## Phase 1: Context Gathering

1. Fetch issue #{{ISSUE}} from {{PROJECT}} repository
2. Extract traceability ID(s) from the issue
3. Fetch requirement details from {{PROJECT}}-docs repository
4. Build a checklist of expected implementations

## Phase 2: Implementation Analysis

1. Search codebase for implementations related to requirements
2. For each requirement item:
   - Locate relevant code files
   - Verify functionality matches specification
   - Check edge cases and error handling
   - Evaluate UI/UX compliance (if applicable)

## Phase 3: Gap Reporting

For each identified gap, output a review-action block:

\`\`\`review-action
{"action":"create-issue","title":"[Gap] Feature X not implemented","body":"## Gap Summary\\n...","labels":["implementation-gap","from-reviewer"]}
\`\`\`

# Review Actions

Use these structured outputs. **Do NOT run \`gh\` commands directly.**

## Create Gap Issue
\`\`\`review-action
{"action":"create-issue","title":"[Gap] Description","body":"## Gap Summary\\n[What is missing]\\n\\n## Requirement Reference\\n- Traceability ID: \`{{TRACEABILITY_ID}}\`\\n- Source Issue: #{{ISSUE}}\\n\\n## Current State\\n[Current implementation]\\n\\n## Expected State\\n[What requirement specifies]\\n\\n## Affected Files\\n- \`path/to/file.ts\`","labels":["implementation-gap","from-reviewer"]}
\`\`\`

## Report Progress (for long reviews)
\`\`\`review-action
{"action":"progress","body":"## Review Progress\\n- Checked: X requirements\\n- Gaps found: Y\\n- Remaining: Z"}
\`\`\`

## Complete Review
\`\`\`review-action
{"action":"complete","summary":"## Review Summary\\n\\n### Reviewed Requirements\\n- req:xxx ✅ Complete\\n- req:yyy ⚠️ Partial\\n- req:zzz ❌ Missing\\n\\n### Created Issues\\n- #XX: Description\\n\\n### Statistics\\n- Total: N\\n- Complete: A (X%)\\n- Partial: B (Y%)\\n- Missing: C (Z%)"}
\`\`\`

# Guidelines

- **Read-only**: Never modify implementation code
- **Objective**: Base all assessments on documented requirements
- **Thorough**: Check all aspects of each requirement
- **Clear**: Write actionable issue descriptions
- **Traceable**: Always link to traceability IDs

# Completion Criteria

{{COMPLETION_CRITERIA_DETAIL}}

# Output

At completion, provide:
1. Summary of requirements reviewed
2. List of gaps found (with created issue numbers)
3. List of requirements verified as complete
4. Confidence assessment for each item
`;

/**
 * Validate configuration structure
 *
 * @param config - Configuration to validate
 * @throws Error if validation fails
 */
function validateConfig(config: ReviewAgentConfig): void {
  if (!config.version) {
    throw new Error("Configuration missing 'version' field");
  }
  if (!config.agents || Object.keys(config.agents).length === 0) {
    throw new Error("Configuration missing 'agents' field");
  }
  if (!config.logging) {
    throw new Error("Configuration missing 'logging' field");
  }
}

/**
 * Deep merge user config over base config
 */
function deepMergeConfig(
  base: ReviewAgentConfig,
  user: Partial<ReviewAgentConfig>,
): ReviewAgentConfig {
  return {
    ...base,
    ...user,
    agents: {
      ...base.agents,
      ...(user.agents ?? {}),
    },
    github: {
      ...base.github,
      ...(user.github ?? {}),
      labels: {
        ...base.github?.labels,
        ...(user.github?.labels ?? {}),
      },
    },
    logging: {
      ...base.logging,
      ...(user.logging ?? {}),
    },
    output: {
      ...base.output,
      ...(user.output ?? {}),
    },
  };
}

/**
 * Load configuration with priority:
 * 1. User config from .agent/reviewer/config.json (merged with default)
 * 2. Package bundled config (fallback)
 *
 * @returns Merged configuration
 */
export async function loadConfig(): Promise<ReviewAgentConfig> {
  // Start with bundled config as base
  const baseConfig = BUNDLED_CONFIG as ReviewAgentConfig;

  try {
    // Try to load user config from .agent/reviewer/config.json
    const userConfigPath = join(Deno.cwd(), USER_CONFIG_PATH);
    const content = await Deno.readTextFile(userConfigPath);
    const userConfig = JSON.parse(content) as Partial<ReviewAgentConfig>;

    // Deep merge user config over base config
    const mergedConfig = deepMergeConfig(baseConfig, userConfig);

    // Validate merged config
    validateConfig(mergedConfig);

    return mergedConfig;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      // No user config, use bundled config
      validateConfig(baseConfig);
      return baseConfig;
    }
    if (error instanceof SyntaxError) {
      throw new Error(
        `Invalid JSON in user configuration file (${USER_CONFIG_PATH}): ${error.message}`,
      );
    }
    throw error;
  }
}

/**
 * Get agent configuration by name
 *
 * @param config - Main configuration
 * @param agentName - Agent name to look up
 * @returns Agent configuration
 * @throws Error if agent not found
 */
export function getAgentConfig(
  config: ReviewAgentConfig,
  agentName: AgentName,
): AgentConfig {
  const agentConfig = config.agents[agentName];
  if (!agentConfig) {
    const availableAgents = Object.keys(config.agents).join(", ");
    throw new Error(
      `Agent '${agentName}' not found in configuration. Available: ${availableAgents}`,
    );
  }
  return agentConfig;
}

/**
 * Ensure log directory exists
 *
 * @param config - Configuration with logging settings
 * @returns Full path to log directory
 */
export async function ensureLogDirectory(
  config: ReviewAgentConfig,
): Promise<string> {
  const cwd = Deno.cwd();
  const logDir = join(cwd, config.logging.directory);

  await Deno.mkdir(logDir, { recursive: true });

  return logDir;
}

/**
 * Build system prompt with variable substitution
 *
 * @param templatePath - Path to template file
 * @param project - Project number or name
 * @param _issue - Issue number (deprecated, kept for compatibility)
 * @param completionCriteriaDetail - Detailed completion criteria
 * @returns Built system prompt
 */
export async function buildSystemPrompt(
  templatePath: string,
  project: string,
  _issue: number,
  completionCriteriaDetail: string,
): Promise<string> {
  const cwd = Deno.cwd();
  const fullPath = join(cwd, templatePath);

  let template: string;
  try {
    template = await Deno.readTextFile(fullPath);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(
        `System prompt template not found at ${fullPath}. Run with --init to create.`,
      );
    }
    throw error;
  }

  // Replace variables
  const prompt = template
    .replace(/\{\{PROJECT\}\}/g, project)
    .replace(/\{\{COMPLETION_CRITERIA_DETAIL\}\}/g, completionCriteriaDetail);

  return prompt;
}

/**
 * Initialize user configuration files
 *
 * Creates config.json and prompts/default.md in .agent/reviewer/ directory.
 * These are user-customizable files that override package defaults.
 *
 * @returns Object with created file paths and status
 */
export async function initializeConfig(): Promise<{
  configCreated: boolean;
  promptCreated: boolean;
  configPath: string;
  promptPath: string;
}> {
  const cwd = Deno.cwd();
  const configPath = join(cwd, USER_CONFIG_PATH);
  const promptPath = join(cwd, ".agent/reviewer/prompts/default.md");

  let configCreated = false;
  let promptCreated = false;

  // Create config.json if not exists
  try {
    await Deno.stat(configPath);
    // File exists, skip
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      // Ensure directory exists
      await Deno.mkdir(join(cwd, ".agent/reviewer"), { recursive: true });
      await Deno.writeTextFile(
        configPath,
        JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n",
      );
      configCreated = true;
    } else {
      throw error;
    }
  }

  // Create prompts/default.md if not exists
  try {
    await Deno.stat(promptPath);
    // File exists, skip
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      // Ensure directory exists
      await Deno.mkdir(join(cwd, ".agent/reviewer/prompts"), {
        recursive: true,
      });
      await Deno.writeTextFile(promptPath, DEFAULT_PROMPT_TEMPLATE);
      promptCreated = true;
    } else {
      throw error;
    }
  }

  return {
    configCreated,
    promptCreated,
    configPath,
    promptPath,
  };
}

/**
 * Load system prompt via breakdown CLI (C3L)
 *
 * Variable passing:
 * - --uv-project, --uv-requirements_label, --uv-review_label: CLI args
 * - completion_criteria_detail: STDIN
 *
 * @param uvVariables - UV variables for prompt expansion
 * @param stdinContent - Content to pass via STDIN (completion_criteria_detail)
 * @returns Expanded system prompt content
 * @throws Error if breakdown CLI fails or returns empty output
 */
export async function loadSystemPromptViaC3L(
  uvVariables: UvVariables,
  stdinContent: string,
): Promise<string> {
  // Build CLI args
  const args = [
    "run",
    "--allow-read",
    "--allow-write",
    "--allow-env",
    "jsr:@aidevtool/climpt",
    "--config=reviewer-dev",
    "start",
    "default",
  ];

  // Add uv- parameters
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
        `Args: ${args.join(" ")}\n` +
        `Stderr: ${errorOutput}`,
    );
  }

  return output;
}
