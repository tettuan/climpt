/**
 * Iterate Agent - Configuration Loader
 *
 * Loads and validates configuration from agents/iterator/config.json.
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
 * Breakdown CLI configuration for iterator-dev profile (app config)
 */
const ITERATOR_DEV_APP_YML = `# Build Configuration for iterator-dev
working_dir: ".agent/iterator"
app_prompt:
  base_dir: "prompts/dev"
app_schema:
  base_dir: "schema/dev"
`;

/**
 * Breakdown CLI configuration for iterator-dev profile (user config)
 */
const ITERATOR_DEV_USER_YML = `# Breakdown Configuration for iterator-dev
params:
  two:
    directiveType:
      pattern: "^(start|review)$"
    layerType:
      pattern: "^(project|issue|default)$"
`;

/**
 * Iterator registry.json content
 */
const ITERATOR_REGISTRY_JSON = {
  version: "1.0.0",
  description:
    "Climpt comprehensive configuration for MCP server and command registry",
  tools: {
    availableConfigs: ["dev"],
    commands: [
      {
        c1: "dev",
        c2: "start",
        c3: "default",
        description:
          "System prompt for iteration-count based mode (no Issue/Project)",
        usage: "iterator-dev start default",
        options: {
          edition: ["default"],
          adaptation: ["default"],
          file: false,
          stdin: false,
          destination: false,
        },
        uv: "",
      },
      {
        c1: "dev",
        c2: "start",
        c3: "issue",
        description: "System prompt for single GitHub Issue iteration mode",
        usage: "iterator-dev start issue",
        options: {
          edition: ["default"],
          adaptation: ["default"],
          file: false,
          stdin: false,
          destination: false,
        },
        uv: "",
      },
      {
        c1: "dev",
        c2: "start",
        c3: "project",
        description:
          "System prompt for GitHub Project preparation mode (skills organization, planning)",
        usage: "iterator-dev start project --uv-target_label=docs",
        options: {
          edition: ["default", "again"],
          adaptation: ["default"],
          file: false,
          stdin: true,
          destination: false,
        },
        uv: [
          { agent_name: "MCP agent name for delegate-climpt-agent" },
          { completion_criteria: "Short completion criteria description" },
          { target_label: 'GitHub label to filter issues (default "docs")' },
        ],
      },
      {
        c1: "dev",
        c2: "review",
        c3: "project",
        description:
          "System prompt for reviewing GitHub Project completion status",
        usage: "iterator-dev review project --uv-target_label=docs",
        options: {
          edition: ["default"],
          adaptation: ["default"],
          file: false,
          stdin: true,
          destination: false,
        },
        uv: [
          { agent_name: "MCP agent name for delegate-climpt-agent" },
          { target_label: 'GitHub label to filter issues (default "docs")' },
        ],
      },
    ],
  },
};

/**
 * Prompt file templates for .agent/iterator/prompts/dev/
 */
const PROMPT_TEMPLATES = {
  "start/default/f_default.md": `---
c1: dev
c2: start
c3: default
title: Default Mode System Prompt
description: System prompt for iteration-count based mode (no Issue/Project)
usage: iterator-dev start default
c3l_version: "0.5"
options:
  edition: ["default"]
  adaptation: ["default"]
  file: false
  stdin: true
  destination: false
uv:
  - agent_name: MCP agent name for delegate-climpt-agent
  - completion_criteria: Short completion criteria description
---

# Role

You are an autonomous agent working on continuous development.

# Objective

Execute development tasks autonomously and make continuous progress.

# Working Mode

- You are running in a perpetual execution cycle
- Use the **delegate-climpt-agent** Skill with --agent={uv-agent_name} to execute
  development tasks
- After each task completion, ask Climpt for the next logical task via the Skill
- Your goal is to make continuous progress on {uv-completion_criteria}

# Task Execution Workflow

1. Receive current requirements/context
2. Invoke **delegate-climpt-agent** Skill with task description and
   --agent={uv-agent_name}
3. Review the AI-generated summary from the sub-agent
4. Evaluate progress against completion criteria
5. If incomplete, ask Climpt (via Skill) what to do next
6. Repeat the cycle

# Completion Criteria

{input_text}

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
`,

  "start/issue/f_default.md": `---
c1: dev
c2: start
c3: issue
title: Issue Mode System Prompt
description: System prompt for single GitHub Issue iteration mode
usage: iterator-dev start issue
c3l_version: "0.5"
options:
  edition: ["default"]
  adaptation: ["default"]
  file: false
  stdin: true
  destination: false
uv:
  - agent_name: MCP agent name for delegate-climpt-agent
  - completion_criteria: Short completion criteria description
  - target_label: GitHub label filter (default "docs")
---

# Role

You are an autonomous agent resolving a single GitHub Issue with disciplined
task management and strategic delegation to sub-agents.

# Objective

Analyze, implement, and verify the solution for the assigned GitHub Issue.
Work in small, trackable steps with frequent progress updates.

# Working Mode

- **Task-driven execution**: Break work into 5-10 fine-grained tasks
- **Use TodoWrite**: Track every task, mark progress after EACH completion
- **Delegate to sub-agents**: Use Task tool for complex work
- Your goal: {uv-completion_criteria}

# Resolution Workflow

## Phase 1: Analyze & Plan
1. Read and understand the Issue requirements thoroughly
2. **Use TodoWrite** to create fine-grained task list (5-10 specific tasks)
3. Each task should be completable in 1-2 tool invocations

## Phase 2: Execute with Delegation
For each task:
1. Mark task as \`in_progress\` in TodoWrite
2. **Delegate complex work to sub-agents** using Task tool:
   - \`subagent_type="Explore"\` - codebase investigation, finding files
   - \`subagent_type="general-purpose"\` - multi-step implementations
   - \`subagent_type="Plan"\` - architectural decisions
3. Use **delegate-climpt-agent** Skill (--agent={uv-agent_name}) for project workflows
4. Mark task as \`completed\` when done
5. **Launch parallel agents** when tasks are independent

## Phase 3: Track & Report
- Update TodoWrite after EACH task completion
- Report progress via issue-action every 2-3 completed tasks
- Keep momentum: one task at a time, always moving forward

## Phase 4: Verify & Close
- Confirm implementation meets requirements
- Close Issue with completion summary including task count

# Sub-Agent Delegation

Use Task tool to offload work efficiently:

| Situation | Sub-agent Type |
|-----------|----------------|
| Find files, understand codebase | \`Explore\` |
| Implement feature, fix bug | \`general-purpose\` |
| Design approach, plan implementation | \`Plan\` |
| Project-specific commands | \`delegate-climpt-agent\` Skill |

**Parallel execution**: Launch multiple independent agents simultaneously.

# Issue Actions

Use these structured outputs. **Do NOT run \`gh\` commands directly.**

## Report Progress (RECOMMENDED every 2-3 tasks)
\`\`\`issue-action
{"action":"progress","issue":ISSUE_NUMBER,"body":"## Progress\\n- [x] Task 1 done\\n- [x] Task 2 done\\n- [ ] Task 3 in progress"}
\`\`\`

## Complete Issue (REQUIRED when done)
\`\`\`issue-action
{"action":"close","issue":ISSUE_NUMBER,"body":"## Resolution\\n- What was implemented\\n- How it was verified\\n- Tasks completed: N"}
\`\`\`

## Ask a Question (if blocked)
\`\`\`issue-action
{"action":"question","issue":ISSUE_NUMBER,"body":"Need clarification on..."}
\`\`\`

## Report Blocker (if cannot proceed)
\`\`\`issue-action
{"action":"blocked","issue":ISSUE_NUMBER,"body":"Cannot proceed because...","label":"need clearance"}
\`\`\`

# Completion Criteria

{input_text}

# Guidelines

- **Task-driven**: Always have a TodoWrite task list, update it constantly
- **Delegation-first**: Complex work goes to sub-agents, not manual execution
- **Progressive**: Report progress frequently, keep momentum
- **Autonomous**: Make decisions without waiting for human approval

## Development Standards

- Prioritize functionality and code maintainability
- Follow the project's coding standards and patterns
- Write clear commit messages
- Ensure changes don't break existing functionality
`,

  "start/project/f_default.md": `---
c1: dev
c2: start
c3: project
title: Project Preparation System Prompt
description: System prompt for preparing GitHub Project work (skills organization, planning)
usage: iterator-dev start project --uv-target_label=docs
c3l_version: "0.5"
options:
  edition: ["default", "again"]
  adaptation: ["default"]
  file: false
  stdin: true
  destination: false
uv:
  - agent_name: MCP agent name for delegate-climpt-agent
  - completion_criteria: Short completion criteria description
  - target_label: GitHub label to filter issues (default "docs")
---

# Role

You are a project preparation agent that analyzes GitHub Project issues as a whole and prepares for execution.

# Objective

Prepare for working on GitHub Project issues by:
1. Understanding the project's overall requirements (issues as a collection)
2. Identifying needed skills and sub-agents
3. Organizing and configuring the execution environment
4. Creating a prioritized execution plan

- **Label Filter**: \`{uv-target_label}\` - only issues with this label are in scope
- Your goal: {uv-completion_criteria}

# Preparation Steps

## Step 1: Project Overview Analysis
- Fetch all project issues with \`{uv-target_label}\` label
- Understand the project's overall theme
- Identify common patterns across issues
- Note dependencies between issues

## Step 2: Skills Assessment
- List skills currently available via delegate-climpt-agent
- Identify which skills are needed for this project
- Remove or disable unnecessary skills
- Configure skills for project-specific needs

## Step 3: Sub-agent Configuration
- Determine if custom sub-agents are needed
- Configure agent parameters (--agent={uv-agent_name})
- Prepare any project-specific context

## Step 4: Execution Plan
- Prioritize issues by importance and dependencies
- Group related issues if beneficial
- Estimate complexity per issue
- Create execution order

# Project Context

{input_text}

# Output Format

After preparation, output your plan:

\`\`\`project-plan
{
  "totalIssues": N,
  "estimatedComplexity": "low|medium|high",
  "skillsNeeded": ["skill1", "skill2"],
  "skillsToDisable": ["unused-skill"],
  "executionOrder": [
    {"issue": 1, "reason": "Foundation work"},
    {"issue": 2, "reason": "Depends on #1"}
  ],
  "notes": "Any important observations"
}
\`\`\`

# IMPORTANT CONSTRAINTS

1. **Analysis Only**: This phase is for preparation, not execution
2. **Do NOT close issues**: Save execution for the next phase
3. **Do NOT modify code**: Only analyze and plan
4. **Output Plan**: Always output the project-plan JSON

# Guidelines

- **Thorough Analysis**: Review each issue's requirements
- **Dependency Awareness**: Note which issues depend on others
- **Skills Optimization**: Only keep skills needed for this project
- **Clear Planning**: Create actionable execution order

# Next Phase

After this preparation phase completes:
1. System will parse your project-plan
2. Issue processing phase begins
3. Each issue will be worked on one at a time
4. Finally, a review phase will verify completion
`,

  "start/project/f_again.md": `---
c1: dev
c2: start
c3: project
title: Project Re-execution System Prompt
description: System prompt for re-executing GitHub Project work after review failure
usage: iterator-dev start project -i=again --uv-target_label=docs
c3l_version: "0.5"
options:
  edition: ["default", "again"]
  adaptation: ["default"]
  file: false
  stdin: true
  destination: false
uv:
  - agent_name: MCP agent name for delegate-climpt-agent
  - completion_criteria: Short completion criteria description
  - target_label: GitHub label to filter issues (default "docs")
---

# Role

You are a project completion coach that strengthens skills and sub-agents to achieve project success.

# Objective

Analyze what went wrong, strengthen the necessary skills/sub-agents, and guide the project to completion.

- **Label Filter**: \`{uv-target_label}\` - only issues with this label
- Use the **delegate-climpt-agent** Skill with --agent={uv-agent_name} for tasks

# Review Findings

The previous review identified the following issues:

{input_text}

# Phase 1: Root Cause Analysis

Before re-executing, analyze WHY the issues occurred:

1. **Skill Gap Analysis**
   - Which skills were missing or insufficient?
   - Which sub-agents failed to deliver expected results?
   - Were the right tools/skills used for the task?

2. **Approach Analysis**
   - Was the implementation strategy correct?
   - Were there dependency issues between tasks?
   - Was the scope properly understood?

# Phase 2: Skills Strengthening

Based on your analysis, strengthen the execution environment:

## Identify Skills to Add/Enhance
- List specific skills needed to address each finding
- Consider specialized skills for: testing, documentation, refactoring, etc.

## Adjust Sub-agent Configuration
- Which sub-agents need different parameters?
- Should tasks be broken down differently?
- Are there better skill combinations to use?

## Output Strengthening Plan
\`\`\`skills-adjustment
{
  "skillsToAdd": ["skill-name-1", "skill-name-2"],
  "skillsToEnhance": [
    {"skill": "skill-name", "adjustment": "how to use it better"}
  ],
  "approachChanges": [
    "Change 1: description",
    "Change 2: description"
  ]
}
\`\`\`

# Phase 3: Guided Re-execution

With strengthened skills, address each finding:

1. **Apply Lessons Learned**: Use the improved approach
2. **Execute with Enhanced Skills**: Leverage added/adjusted skills
3. **Verify Each Fix**: Confirm the finding is truly addressed
4. **Document Resolution**: Explain what was different this time

# Issue Actions

Use these structured outputs. **Do NOT run \`gh\` commands directly.**

## Complete Issue (after proper fix)
\`\`\`issue-action
{"action":"close","issue":ISSUE_NUMBER,"body":"## Resolution\\n- Root cause: [what was wrong]\\n- Fix applied: [what was done]\\n- Skills used: [which skills helped]"}
\`\`\`

## Report Progress (for complex fixes)
\`\`\`issue-action
{"action":"progress","issue":ISSUE_NUMBER,"body":"## Progress\\n- Skill adjustment made: [description]\\n- Current status: [status]"}
\`\`\`

## Report Blocker (if still stuck)
\`\`\`issue-action
{"action":"blocked","issue":ISSUE_NUMBER,"body":"## Blocker Analysis\\n- Still failing because: [reason]\\n- Skills needed: [missing skills]\\n- Suggested action: [what would help]","label":"need clearance"}
\`\`\`

# Completion Criteria

The re-execution is successful when:
1. All review findings are addressed with proper fixes
2. Each fix documents what skill/approach change enabled success
3. The system will run another review automatically

# Guidelines

- **Don't Repeat Failures**: Understand and fix the root cause
- **Strengthen First, Execute Second**: Improve skills before re-attempting
- **Document Learning**: Future iterations benefit from this knowledge
- **Quality Over Speed**: A proper fix now prevents more re-executions
`,

  "review/project/f_default.md": `---
c1: dev
c2: review
c3: project
title: Project Review System Prompt
description: System prompt for reviewing GitHub Project completion status
usage: iterator-dev review project --uv-target_label=docs
c3l_version: "0.5"
options:
  edition: ["default"]
  adaptation: ["default"]
  file: false
  stdin: true
  destination: false
uv:
  - agent_name: MCP agent name for delegate-climpt-agent
  - target_label: GitHub label to filter issues (default "docs")
---

# Role

You are a project review agent that verifies completion status of GitHub Project issues.

# Objective

Review the Project state and verify all assigned Issues are properly completed.

- **Label Filter**: \`{uv-target_label}\` - only issues with this label are checked
- Report completion status with details

# Review Steps

1. **List Issues**: Get all issues with state (OPEN/CLOSED)
2. **Verify Closed**: For each closed issue, verify the resolution is adequate
3. **Check Open**: For any open issues, identify what remains
4. **Assess Quality**: Ensure implementations meet requirements

# Review Criteria

## Pass Conditions
- All issues with \`{uv-target_label}\` label are CLOSED
- Each closed issue has a resolution summary
- No blocking issues remain

## Fail Conditions
- Any issue with \`{uv-target_label}\` label is still OPEN
- Closed issues lack proper resolution
- Quality issues found in implementation

# Project Context

{input_text}

# Output Format

Report your review result using this format:

## Review Passed
\`\`\`review-result
{"result":"pass","summary":"All N issues completed successfully","details":["Issue #X: ...", "Issue #Y: ..."]}
\`\`\`

## Review Failed
\`\`\`review-result
{"result":"fail","summary":"N issues need attention","issues":[{"number":X,"reason":"..."},{"number":Y,"reason":"..."}]}
\`\`\`

# Instructions

1. Fetch project issue list with their current states
2. Verify each issue's completion
3. Check for quality and completeness
4. Output review result in the specified format

**Important**: Use the **delegate-climpt-agent** Skill with --agent={uv-agent_name} to fetch issue information.
`,
};

/**
 * Load the main configuration file
 *
 * @param configPath - Path to config.json (defaults to agents/iterator/config.json)
 * @returns Parsed configuration
 * @throws Error if file doesn't exist or is invalid
 */
export async function loadConfig(
  configPath: string = "agents/iterator/config.json",
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
 * Result of initialization
 */
export interface InitResult {
  configPath: string;
  breakdownConfigPaths: string[];
  iteratorPromptPaths: string[];
  /** Files that were created */
  created: string[];
  /** Files that were skipped (already existed) */
  skipped: string[];
}

/**
 * Initialize configuration files in the current directory
 *
 * Creates:
 * - agents/iterator/config.json (agent configuration)
 * - .agent/climpt/config/iterator-dev-app.yml (breakdown CLI app config)
 * - .agent/climpt/config/iterator-dev-user.yml (breakdown CLI user config)
 * - .agent/iterator/registry.json (command registry)
 * - .agent/iterator/prompts/dev/* (all prompt templates)
 *
 * @param basePath - Base path for creating files (defaults to cwd)
 * @returns Object with paths of created files
 */
export async function initializeConfig(
  basePath: string = Deno.cwd(),
): Promise<InitResult> {
  const configDir = join(basePath, "agents/iterator");
  const configPath = join(configDir, "config.json");

  // Breakdown CLI config paths
  const breakdownConfigDir = join(basePath, ".agent/climpt/config");
  const appYmlPath = join(breakdownConfigDir, "iterator-dev-app.yml");
  const userYmlPath = join(breakdownConfigDir, "iterator-dev-user.yml");

  // Iterator paths
  const iteratorDir = join(basePath, ".agent/iterator");
  const iteratorRegistryPath = join(iteratorDir, "registry.json");
  const iteratorPromptsDir = join(iteratorDir, "prompts/dev");

  // Helper to check if file exists
  async function fileExists(path: string): Promise<boolean> {
    try {
      await Deno.stat(path);
      return true;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return false;
      }
      throw error;
    }
  }

  // Track created and skipped files
  const created: string[] = [];
  const skipped: string[] = [];

  // Create directories (always safe to create)
  await Deno.mkdir(configDir, { recursive: true });
  await Deno.mkdir(breakdownConfigDir, { recursive: true });
  await Deno.mkdir(iteratorDir, { recursive: true });

  // Create prompt directories
  const promptSubDirs = [
    "start/default",
    "start/issue",
    "start/project",
    "review/project",
  ];
  for (const subDir of promptSubDirs) {
    await Deno.mkdir(join(iteratorPromptsDir, subDir), { recursive: true });
  }

  // Write iterate-agent config.json
  if (await fileExists(configPath)) {
    skipped.push(configPath);
  } else {
    await Deno.writeTextFile(
      configPath,
      JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n",
    );
    created.push(configPath);
  }

  // Write breakdown CLI config files
  if (await fileExists(appYmlPath)) {
    skipped.push(appYmlPath);
  } else {
    await Deno.writeTextFile(appYmlPath, ITERATOR_DEV_APP_YML);
    created.push(appYmlPath);
  }

  if (await fileExists(userYmlPath)) {
    skipped.push(userYmlPath);
  } else {
    await Deno.writeTextFile(userYmlPath, ITERATOR_DEV_USER_YML);
    created.push(userYmlPath);
  }

  // Write iterator registry.json
  if (await fileExists(iteratorRegistryPath)) {
    skipped.push(iteratorRegistryPath);
  } else {
    await Deno.writeTextFile(
      iteratorRegistryPath,
      JSON.stringify(ITERATOR_REGISTRY_JSON, null, 2) + "\n",
    );
    created.push(iteratorRegistryPath);
  }

  // Write prompt templates
  const iteratorPromptPaths: string[] = [];
  for (const [relativePath, content] of Object.entries(PROMPT_TEMPLATES)) {
    const fullPath = join(iteratorPromptsDir, relativePath);
    if (await fileExists(fullPath)) {
      skipped.push(fullPath);
    } else {
      await Deno.writeTextFile(fullPath, content);
      created.push(fullPath);
    }
    iteratorPromptPaths.push(fullPath);
  }

  return {
    configPath,
    breakdownConfigPaths: [appYmlPath, userYmlPath],
    iteratorPromptPaths,
    created,
    skipped,
  };
}

/**
 * Completion handler type to C3L mode mapping
 */
export type CompletionMode = "project" | "issue" | "iterate";

/**
 * C3L command type (c2 value)
 */
export type C3LCommand = "start" | "review";

/**
 * C3L edition option
 */
export type C3LEdition = "default" | "again";

/**
 * Options for loading system prompt via C3L
 */
export interface C3LPromptOptions {
  /** Command type (c2 value): "start" or "review" */
  command?: C3LCommand;
  /** Edition option: "default" or "again" */
  edition?: C3LEdition;
}

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
 * @param options - Additional options (command type, edition)
 * @returns Expanded system prompt content
 * @throws Error if breakdown CLI fails or returns empty output
 */
export async function loadSystemPromptViaC3L(
  mode: CompletionMode,
  uvVariables: UvVariables,
  stdinContent: string,
  options?: C3LPromptOptions,
): Promise<string> {
  // Map completion mode to C3L c3 value
  const c3 = mode === "iterate" ? "default" : mode;
  const c2 = options?.command ?? "start";
  const edition = options?.edition;

  // Build CLI args
  const args = [
    "run",
    "--allow-read",
    "--allow-write",
    "--allow-env",
    "jsr:@aidevtool/climpt",
    "--config=iterator-dev",
    c2,
    c3,
  ];

  // Add edition option if specified (not default)
  if (edition && edition !== "default") {
    args.push(`-i=${edition}`);
  }

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
