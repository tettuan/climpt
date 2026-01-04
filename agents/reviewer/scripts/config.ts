/**
 * Review Agent - Configuration Module
 *
 * Handles configuration loading, validation, and system prompt building.
 */

import { join } from "@std/path";
import type { AgentConfig, AgentName, ReviewAgentConfig } from "./types.ts";

/**
 * Default configuration file path (relative to working directory)
 */
const CONFIG_FILE_PATH = "agents/reviewer/config.json";

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
 * Load configuration from file
 *
 * @returns Loaded configuration
 * @throws Error if configuration file not found or invalid
 */
export async function loadConfig(): Promise<ReviewAgentConfig> {
  const cwd = Deno.cwd();
  const configPath = join(cwd, CONFIG_FILE_PATH);

  try {
    const content = await Deno.readTextFile(configPath);
    const config = JSON.parse(content) as ReviewAgentConfig;

    // Validate required fields
    if (!config.version) {
      throw new Error("Configuration missing 'version' field");
    }
    if (!config.agents || Object.keys(config.agents).length === 0) {
      throw new Error("Configuration missing 'agents' field");
    }
    if (!config.logging) {
      throw new Error("Configuration missing 'logging' field");
    }

    return config;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(
        `Configuration not found at ${configPath}. Run with --init to create.`,
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
 * Initialize configuration files
 *
 * Creates config.json and prompts/default.md in review-agent directory.
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
  const configPath = join(cwd, CONFIG_FILE_PATH);
  const promptPath = join(cwd, "agents/reviewer/prompts/default.md");

  let configCreated = false;
  let promptCreated = false;

  // Create config.json if not exists
  try {
    await Deno.stat(configPath);
    // File exists, skip
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      // Ensure directory exists
      await Deno.mkdir(join(cwd, "agents/reviewer"), { recursive: true });
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
      await Deno.mkdir(join(cwd, "agents/reviewer/prompts"), {
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
