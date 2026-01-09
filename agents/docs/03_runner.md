# Generic Agent Runner Design

## Overview

The Generic Agent Runner is the core execution engine that loads agent
definitions and runs agents using the Claude Agent SDK. It provides a unified
execution model for all agent types.

## Architecture

```
+-------------------------------------------------------------------------+
|                          AgentRunner                                     |
|                                                                          |
|  +-----------+  +-----------+  +-----------+  +-----------+            |
|  |   Loader  |  |  Prompter |  | Completion|  |   Action  |            |
|  |           |  |  Resolver |  |  Handler  |  |  Executor |            |
|  +-----+-----+  +-----+-----+  +-----+-----+  +-----+-----+            |
|        |              |              |              |                    |
|        v              v              v              v                    |
|  +------------------------------------------------------------------+  |
|  |                        Agent Loop                                 |  |
|  |   +---------+    +---------+    +---------+    +---------+      |  |
|  |   | Build   |--->| Query   |--->| Process |--->| Check   |      |  |
|  |   | Prompt  |    | Claude  |    | Results |    |Complete |      |  |
|  |   +---------+    +---------+    +---------+    +----+----+      |  |
|  |                                                      |           |  |
|  |                       <------------------------------+           |  |
|  +------------------------------------------------------------------+  |
|                                                                          |
+-------------------------------------------------------------------------+
```

## Core Components

### AgentRunner Class

```typescript
// agents/common/runner.ts

import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentDefinition,
  AgentResult,
  IterationSummary,
} from "./types.ts";
import {
  type CompletionHandler,
  createCompletionHandler,
} from "../completion/mod.ts";
import { PromptResolver } from "./prompt-resolver.ts";
import { ActionDetector, ActionExecutor } from "../actions/mod.ts";
import { Logger } from "./logger.ts";

export interface RunnerOptions {
  /** Working directory */
  cwd?: string;
  /** CLI arguments */
  args: Record<string, unknown>;
  /** Custom plugins */
  plugins?: string[];
}

export class AgentRunner {
  private definition: AgentDefinition;
  private completionHandler: CompletionHandler;
  private promptResolver: PromptResolver;
  private actionDetector?: ActionDetector;
  private actionExecutor?: ActionExecutor;
  private logger: Logger;

  constructor(definition: AgentDefinition) {
    this.definition = definition;
  }

  async initialize(options: RunnerOptions): Promise<void> {
    const { cwd = Deno.cwd(), args } = options;

    // Initialize logger
    this.logger = await Logger.create({
      agentName: this.definition.name,
      directory: this.definition.logging.directory,
      format: this.definition.logging.format,
    });

    // Initialize completion handler
    this.completionHandler = await createCompletionHandler(
      this.definition,
      args,
    );

    // Initialize prompt resolver
    this.promptResolver = await PromptResolver.create({
      agentName: this.definition.name,
      agentDir: join(cwd, ".agent", this.definition.name),
      registryPath: this.definition.prompts.registry,
    });

    // Initialize action system if enabled
    if (this.definition.actions?.enabled) {
      this.actionDetector = new ActionDetector(this.definition.actions);
      this.actionExecutor = new ActionExecutor(this.definition.actions, {
        agentName: this.definition.name,
        logger: this.logger,
      });
    }
  }

  async run(options: RunnerOptions): Promise<AgentResult> {
    await this.initialize(options);

    const { cwd = Deno.cwd(), args, plugins = [] } = options;

    this.logger.info(`Starting agent: ${this.definition.displayName}`);

    let iteration = 0;
    let sessionId: string | undefined;
    const summaries: IterationSummary[] = [];

    try {
      while (true) {
        iteration++;
        this.logger.info(`=== Iteration ${iteration} ===`);

        // Build prompt
        const prompt = iteration === 1
          ? await this.completionHandler.buildInitialPrompt(args)
          : await this.completionHandler.buildContinuationPrompt(
            iteration,
            summaries,
          );

        const systemPrompt = await this.promptResolver.resolveSystemPrompt({
          "uv-agent_name": this.definition.name,
          "uv-completion_criteria":
            this.completionHandler.buildCompletionCriteria().detailed,
        });

        // Execute Claude SDK query
        const summary = await this.executeQuery({
          prompt,
          systemPrompt,
          cwd,
          plugins,
          sessionId,
          iteration,
        });

        summaries.push(summary);
        sessionId = summary.sessionId;

        // Execute detected actions
        if (this.actionExecutor && summary.detectedActions.length > 0) {
          await this.actionExecutor.execute(summary.detectedActions);
        }

        // Check completion
        if (await this.completionHandler.isComplete(summary)) {
          this.logger.info("Agent completed");
          break;
        }

        // Max iteration check
        const maxIterations = this.getMaxIterations();
        if (iteration >= maxIterations) {
          this.logger.warn(`Max iterations (${maxIterations}) reached`);
          break;
        }
      }

      return {
        success: true,
        totalIterations: iteration,
        summaries,
        completionReason: await this.completionHandler.getCompletionDescription(
          summaries[summaries.length - 1],
        ),
      };
    } finally {
      await this.logger.close();
    }
  }

  private async executeQuery(options: {
    prompt: string;
    systemPrompt: string;
    cwd: string;
    plugins: string[];
    sessionId?: string;
    iteration: number;
  }): Promise<IterationSummary> {
    const { prompt, systemPrompt, cwd, plugins, sessionId, iteration } =
      options;

    const summary: IterationSummary = {
      iteration,
      sessionId: undefined,
      assistantResponses: [],
      toolsUsed: [],
      detectedActions: [],
      errors: [],
    };

    const queryIterator = query({
      prompt,
      options: {
        cwd,
        systemPrompt,
        allowedTools: this.definition.behavior.allowedTools,
        permissionMode: this.definition.behavior.permissionMode,
        settingSources: ["user", "project"],
        plugins,
        resume: sessionId,
      },
    });

    for await (const message of queryIterator) {
      this.logger.logSdkMessage(message);

      switch (message.type) {
        case "assistant":
          summary.assistantResponses.push(message.message.content);

          // Detect actions
          if (this.actionDetector) {
            const actions = this.actionDetector.detect(message.message.content);
            summary.detectedActions.push(...actions);
          }
          break;

        case "tool_use":
          summary.toolsUsed.push(message.tool_name);
          break;

        case "result":
          summary.sessionId = message.session_id;
          break;

        case "error":
          summary.errors.push(message.error.message);
          this.logger.error("SDK error", { error: message.error });
          break;
      }
    }

    return summary;
  }

  private getMaxIterations(): number {
    if (this.definition.behavior.completionType === "iterate") {
      return this.definition.behavior.completionConfig.maxIterations ?? 100;
    }
    return 100; // Default max
  }
}
```

### Agent Loader

```typescript
// agents/common/loader.ts

import { join } from "@std/path";
import type { AgentDefinition } from "./types.ts";

export async function loadAgentDefinition(
  agentName: string,
  cwd: string = Deno.cwd(),
): Promise<AgentDefinition> {
  const agentDir = join(cwd, ".agent", agentName);
  const definitionPath = join(agentDir, "agent.json");

  // Check if file exists
  try {
    await Deno.stat(definitionPath);
  } catch {
    throw new Error(`Agent definition not found: ${definitionPath}`);
  }

  // Load and parse
  const content = await Deno.readTextFile(definitionPath);
  const definition = JSON.parse(content) as AgentDefinition;

  // Validate
  const validation = validateAgentDefinition(definition);
  if (!validation.valid) {
    throw new Error(
      `Invalid agent definition:\n${validation.errors.join("\n")}`,
    );
  }

  // Log warnings
  for (const warning of validation.warnings) {
    console.warn(`Warning: ${warning}`);
  }

  return definition;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateAgentDefinition(
  def: AgentDefinition,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required fields
  if (!def.version) errors.push("version is required");
  if (!def.name) errors.push("name is required");
  if (!def.displayName) errors.push("displayName is required");
  if (!def.behavior) errors.push("behavior is required");
  if (!def.behavior?.systemPromptPath) {
    errors.push("behavior.systemPromptPath is required");
  }
  if (!def.behavior?.completionType) {
    errors.push("behavior.completionType is required");
  }
  if (!def.prompts) errors.push("prompts is required");
  if (!def.logging) errors.push("logging is required");

  // Name format
  if (def.name && !/^[a-z][a-z0-9-]*$/.test(def.name)) {
    errors.push("name must be lowercase kebab-case");
  }

  // Completion config validation
  if (def.behavior?.completionType === "iterate") {
    if (!def.behavior.completionConfig?.maxIterations) {
      errors.push("maxIterations required for iterate completion type");
    }
  }
  if (def.behavior?.completionType === "manual") {
    if (!def.behavior.completionConfig?.completionKeyword) {
      errors.push("completionKeyword required for manual completion type");
    }
  }
  if (def.behavior?.completionType === "custom") {
    if (!def.behavior.completionConfig?.handlerPath) {
      errors.push("handlerPath required for custom completion type");
    }
  }

  // Parameter validation
  for (const [name, param] of Object.entries(def.parameters ?? {})) {
    if (!param.cli) {
      errors.push(`Parameter '${name}' missing cli flag`);
    }
    if (!param.cli.startsWith("--")) {
      errors.push(`Parameter '${name}' cli flag must start with '--'`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
```

### CLI Parser

```typescript
// agents/common/cli.ts

import { parseArgs } from "@std/cli/parse-args";
import type { AgentDefinition, ParameterDefinition } from "./types.ts";
import { loadAgentDefinition } from "./loader.ts";

export interface ParsedCliArgs {
  agentName: string;
  args: Record<string, unknown>;
  init?: boolean;
  help?: boolean;
}

export async function parseCliArgs(cliArgs: string[]): Promise<ParsedCliArgs> {
  // First pass: get agent name and flags
  const initial = parseArgs(cliArgs, {
    string: ["agent"],
    boolean: ["init", "help"],
    alias: { h: "help" },
  });

  if (initial.help) {
    return { agentName: "", args: {}, help: true };
  }

  if (initial.init) {
    return { agentName: initial.agent ?? "", args: {}, init: true };
  }

  const agentName = initial.agent;
  if (!agentName) {
    throw new Error("--agent <name> is required");
  }

  // Load definition to get parameter specs
  const definition = await loadAgentDefinition(agentName);

  // Build parser config from parameters
  const parseConfig = buildParseConfig(definition.parameters);
  const parsed = parseArgs(cliArgs, parseConfig);

  // Extract and validate parameter values
  const args = extractParameterValues(parsed, definition.parameters);
  validateRequiredParameters(args, definition.parameters);

  return { agentName, args };
}

function buildParseConfig(
  parameters: Record<string, ParameterDefinition>,
): Parameters<typeof parseArgs>[1] {
  const config: Parameters<typeof parseArgs>[1] = {
    string: ["agent"],
    boolean: ["init", "help"],
    default: {},
    alias: { h: "help" },
  };

  for (const [name, param] of Object.entries(parameters)) {
    const flag = param.cli.replace(/^--/, "");

    switch (param.type) {
      case "string":
        (config.string as string[]).push(flag);
        break;
      case "boolean":
        (config.boolean as string[]).push(flag);
        break;
      case "number":
        // Parse as string, convert later
        (config.string as string[]).push(flag);
        break;
      case "array":
        // Handle as collect
        (config.string as string[]).push(flag);
        break;
    }

    if (param.default !== undefined) {
      config.default![flag] = param.default;
    }
  }

  return config;
}

function extractParameterValues(
  parsed: Record<string, unknown>,
  parameters: Record<string, ParameterDefinition>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [name, param] of Object.entries(parameters)) {
    const flag = param.cli.replace(/^--/, "");
    let value = parsed[flag];

    if (value === undefined) {
      value = param.default;
    }

    // Type conversion
    if (value !== undefined) {
      switch (param.type) {
        case "number":
          value = Number(value);
          if (isNaN(value as number)) {
            throw new Error(`Parameter '${name}' must be a number`);
          }
          break;
        case "boolean":
          value = Boolean(value);
          break;
        case "array":
          if (typeof value === "string") {
            value = [value];
          }
          break;
      }
    }

    result[name] = value;
  }

  return result;
}

function validateRequiredParameters(
  args: Record<string, unknown>,
  parameters: Record<string, ParameterDefinition>,
): void {
  for (const [name, param] of Object.entries(parameters)) {
    if (param.required && args[name] === undefined) {
      throw new Error(`Required parameter '${name}' (${param.cli}) is missing`);
    }

    // Validation rules
    if (args[name] !== undefined && param.validation) {
      const value = args[name];

      if (
        param.validation.min !== undefined &&
        (value as number) < param.validation.min
      ) {
        throw new Error(
          `Parameter '${name}' must be >= ${param.validation.min}`,
        );
      }

      if (
        param.validation.max !== undefined &&
        (value as number) > param.validation.max
      ) {
        throw new Error(
          `Parameter '${name}' must be <= ${param.validation.max}`,
        );
      }

      if (param.validation.pattern) {
        const regex = new RegExp(param.validation.pattern);
        if (!regex.test(String(value))) {
          throw new Error(
            `Parameter '${name}' must match pattern: ${param.validation.pattern}`,
          );
        }
      }

      if (
        param.validation.enum && !param.validation.enum.includes(String(value))
      ) {
        throw new Error(
          `Parameter '${name}' must be one of: ${
            param.validation.enum.join(", ")
          }`,
        );
      }
    }
  }
}
```

## CLI Entry Point

```typescript
// agents/cli.ts

import { parseCliArgs } from "./common/cli.ts";
import { loadAgentDefinition } from "./common/loader.ts";
import { AgentRunner } from "./common/runner.ts";
import { initAgent } from "./init.ts";

export async function run(): Promise<void> {
  try {
    const parsed = await parseCliArgs(Deno.args);

    if (parsed.help) {
      printHelp();
      return;
    }

    if (parsed.init) {
      await initAgent(parsed.agentName);
      return;
    }

    const definition = await loadAgentDefinition(parsed.agentName);
    const runner = new AgentRunner(definition);

    const result = await runner.run({
      cwd: Deno.cwd(),
      args: parsed.args,
    });

    console.log(`\n=== Agent Complete ===`);
    console.log(`Total iterations: ${result.totalIterations}`);
    console.log(`Reason: ${result.completionReason}`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    Deno.exit(1);
  }
}

function printHelp(): void {
  console.log(`
climpt-agents - Generic Agent Runner

Usage:
  deno run -A agents/cli.ts --agent <name> [options]
  deno run -A agents/cli.ts --init --agent <name>

  Or with tasks:
  deno task agent --agent <name> [options]

Options:
  --agent <name>    Agent name (required)
  --init            Initialize new agent template
  --help, -h        Show this help

Examples:
  # Run iterator agent
  deno task agent:iterator --issue 123

  # Initialize new agent
  deno task init --agent my-agent
`);
}

// Main entry
if (import.meta.main) {
  await run();
}
```

## Result Types

```typescript
// agents/common/types.ts (additions)

export interface AgentResult {
  success: boolean;
  totalIterations: number;
  summaries: IterationSummary[];
  completionReason: string;
  error?: string;
}

export interface IterationSummary {
  iteration: number;
  sessionId?: string;
  assistantResponses: string[];
  toolsUsed: string[];
  detectedActions: DetectedAction[];
  actionResults?: ActionResult[];
  errors: string[];
}
```

## Usage

### Command Line

```bash
# Basic usage
deno run -A jsr:@aidevtool/climpt/agents/iterator --issue 123

# Or with task
deno task agent:iterator --issue 123

# With all options
deno task agent:iterator \
  --issue 123 \
  --max-iterations 20
```

### Programmatic

```typescript
import { runIterator } from "jsr:@aidevtool/climpt/agents";

// Load and run
const result = await runIterator({
  issue: 123,
  maxIterations: 20,
  cwd: Deno.cwd(),
});

if (result.success) {
  console.log("Completed:", result.completionReason);
} else {
  console.error("Failed:", result.error);
}
```

### With deno.json Task

```json
{
  "tasks": {
    "agent:iterator": "deno run -A jsr:@aidevtool/climpt/agents/iterator",
    "agent:reviewer": "deno run -A jsr:@aidevtool/climpt/agents/reviewer"
  }
}
```

```bash
# Using tasks
deno task agent:iterator --issue 123
deno task agent:reviewer --target src/
```
