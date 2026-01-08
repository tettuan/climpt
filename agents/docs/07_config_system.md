# Configuration System Design

## Overview

The configuration system uses a layered approach where settings can be defined
at multiple levels, with higher priority levels overriding lower ones.

## Configuration Layers

```
Priority (High -> Low):

  1. CLI Arguments
     +-- --max-iterations 10, --permission-mode plan

  2. .agent/{name}/config.json
     +-- Project-specific runtime settings

  3. agent.json defaults
     +-- Agent definition defaults

  4. Package defaults
     +-- Built-in defaults from climpt-agents
```

## File Structure

### agent.json (Agent Definition)

Defines agent behavior and default values. **Low change frequency.**

```json
{
  "$schema": "https://raw.githubusercontent.com/tettuan/climpt/main/agents/schemas/agent.schema.json",
  "version": "1.0.0",

  "name": "facilitator",
  "displayName": "Facilitator Agent",
  "description": "Meeting facilitation agent",

  "behavior": {
    "systemPromptPath": "prompts/system.md",
    "completionType": "manual",
    "completionConfig": {
      "completionKeyword": "SESSION_COMPLETE"
    },
    "allowedTools": ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
    "permissionMode": "acceptEdits"
  },

  "parameters": {
    "topic": {
      "type": "string",
      "description": "Session topic",
      "required": true,
      "cli": "--topic"
    }
  },

  "prompts": {
    "registry": "steps_registry.json",
    "fallbackDir": "prompts/"
  },

  "logging": {
    "directory": "tmp/logs/agents/facilitator",
    "format": "jsonl"
  }
}
```

### config.json (Runtime Configuration)

Environment-specific and runtime settings. **Medium-high change frequency.**

```json
{
  "version": "1.0.0",

  "overrides": {
    "permissionMode": "plan",
    "allowedTools": ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Skill"]
  },

  "github": {
    "apiVersion": "2022-11-28",
    "labels": {
      "filter": "facilitation"
    }
  },

  "logging": {
    "maxFiles": 50,
    "verbose": true
  },

  "worktree": {
    "enabled": false,
    "root": "../worktrees"
  }
}
```

### steps_registry.json (Step Definitions)

Prompt step mappings. **Low change frequency.**

```json
{
  "version": "1.0.0",
  "basePath": "prompts",
  "steps": {
    "system": {
      "name": "System Prompt",
      "path": "system.md",
      "variables": ["uv-agent_name", "uv-completion_criteria"]
    },
    "initial_manual": {
      "name": "Session Start",
      "c1": "steps",
      "c2": "initial",
      "c3": "manual",
      "edition": "default",
      "variables": ["uv-topic", "uv-completion_keyword"]
    }
  }
}
```

## Type Definitions

```typescript
// agents/common/types.ts

/** Runtime configuration (config.json) */
export interface RuntimeConfig {
  version: string;

  /** Override settings from agent.json */
  overrides?: {
    permissionMode?: PermissionMode;
    allowedTools?: string[];
  };

  /** GitHub settings */
  github?: {
    apiVersion?: string;
    labels?: Record<string, string>;
  };

  /** Logging settings */
  logging?: {
    maxFiles?: number;
    verbose?: boolean;
  };

  /** Worktree settings */
  worktree?: {
    enabled?: boolean;
    root?: string;
  };
}

/** Merged configuration */
export interface MergedConfig {
  agent: AgentDefinition;
  runtime: RuntimeConfig;
  cli: CliConfig;
}

/** CLI configuration */
export interface CliConfig {
  agentName: string;
  params: Record<string, unknown>;
  permissionMode?: PermissionMode;
  maxIterations?: number;
  debug?: boolean;
}
```

## Configuration Loading

```typescript
// agents/common/config.ts

import { join } from "@std/path";
import type {
  AgentDefinition,
  CliConfig,
  MergedConfig,
  RuntimeConfig,
} from "./types.ts";
import { deepMerge } from "./merge.ts";

export async function loadMergedConfig(
  agentName: string,
  cliConfig: CliConfig,
  cwd: string = Deno.cwd(),
): Promise<MergedConfig> {
  const agentDir = join(cwd, ".agent", agentName);

  // 1. Load agent definition
  const agent = await loadAgentDefinition(agentDir);

  // 2. Load runtime config (with defaults)
  const runtime = await loadRuntimeConfig(agentDir);

  // 3. Merge all layers
  return mergeConfigs(agent, runtime, cliConfig);
}

async function loadAgentDefinition(agentDir: string): Promise<AgentDefinition> {
  const path = join(agentDir, "agent.json");
  const content = await Deno.readTextFile(path);
  return JSON.parse(content);
}

async function loadRuntimeConfig(agentDir: string): Promise<RuntimeConfig> {
  const path = join(agentDir, "config.json");

  try {
    const content = await Deno.readTextFile(path);
    return deepMerge(getDefaultRuntimeConfig(), JSON.parse(content));
  } catch {
    // config.json is optional
    return getDefaultRuntimeConfig();
  }
}

function getDefaultRuntimeConfig(): RuntimeConfig {
  return {
    version: "1.0.0",
    github: {
      apiVersion: "2022-11-28",
    },
    logging: {
      maxFiles: 100,
      verbose: false,
    },
    worktree: {
      enabled: false,
    },
  };
}

function mergeConfigs(
  agent: AgentDefinition,
  runtime: RuntimeConfig,
  cli: CliConfig,
): MergedConfig {
  // Apply overrides
  const mergedAgent = {
    ...agent,
    behavior: {
      ...agent.behavior,
      // Runtime overrides
      ...(runtime.overrides?.permissionMode && {
        permissionMode: runtime.overrides.permissionMode,
      }),
      ...(runtime.overrides?.allowedTools && {
        allowedTools: runtime.overrides.allowedTools,
      }),
      // CLI overrides
      ...(cli.permissionMode && {
        permissionMode: cli.permissionMode,
      }),
    },
  };

  // Handle maxIterations override for iterate type
  if (
    mergedAgent.behavior.completionType === "iterate" &&
    cli.maxIterations
  ) {
    mergedAgent.behavior.completionConfig = {
      ...mergedAgent.behavior.completionConfig,
      maxIterations: cli.maxIterations,
    };
  }

  return {
    agent: mergedAgent,
    runtime,
    cli,
  };
}
```

## Deep Merge Utility

```typescript
// agents/common/merge.ts

export function deepMerge<T extends Record<string, unknown>>(
  base: T,
  override: Partial<T>,
): T {
  const result = { ...base };

  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;

    if (isPlainObject(value) && isPlainObject(result[key])) {
      // Recursively merge objects
      result[key] = deepMerge(
        result[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      ) as T[keyof T];
    } else if (Array.isArray(value)) {
      // Arrays are replaced, not merged
      result[key] = [...value] as T[keyof T];
    } else {
      // Primitives are overwritten
      result[key] = value as T[keyof T];
    }
  }

  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
```

## Configuration Validation

```typescript
// agents/common/config_validator.ts

import type { MergedConfig } from "./types.ts";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateConfig(config: MergedConfig): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required fields
  if (!config.agent.name) {
    errors.push("agent.name is required");
  }
  if (!config.agent.behavior.completionType) {
    errors.push("agent.behavior.completionType is required");
  }

  // Completion type validation
  switch (config.agent.behavior.completionType) {
    case "iterate":
      if (!config.agent.behavior.completionConfig?.maxIterations) {
        errors.push("maxIterations is required for iterate completion type");
      }
      break;
    case "manual":
      if (!config.agent.behavior.completionConfig?.completionKeyword) {
        errors.push("completionKeyword is required for manual completion type");
      }
      break;
    case "custom":
      if (!config.agent.behavior.completionConfig?.handlerPath) {
        errors.push("handlerPath is required for custom completion type");
      }
      break;
  }

  // Warnings
  if (config.runtime.worktree?.enabled && !config.cli.params.branch) {
    warnings.push("worktree enabled but no branch specified");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
```

## Environment Variables

Certain settings can be set via environment variables:

| Variable                | Description            | Default |
| ----------------------- | ---------------------- | ------- |
| `CLIMPT_AGENTS_DEBUG`   | Enable debug logging   | `false` |
| `CLIMPT_AGENTS_LOG_DIR` | Override log directory | -       |
| `GITHUB_TOKEN`          | GitHub API token       | -       |

```typescript
// agents/common/env.ts

export function getEnvConfig(): Partial<RuntimeConfig> {
  const config: Partial<RuntimeConfig> = {};

  if (Deno.env.get("CLIMPT_AGENTS_DEBUG") === "true") {
    config.logging = { verbose: true };
  }

  const logDir = Deno.env.get("CLIMPT_AGENTS_LOG_DIR");
  if (logDir) {
    config.logging = { ...config.logging, directory: logDir };
  }

  return config;
}
```

## Agent Initialization

The `--init` command creates default configuration files:

```typescript
// agents/init.ts

import { join } from "@std/path";

export async function initAgent(
  agentName: string,
  cwd: string = Deno.cwd(),
): Promise<void> {
  const agentDir = join(cwd, ".agent", agentName);

  // Create directories
  await Deno.mkdir(join(agentDir, "prompts", "steps", "initial", "manual"), {
    recursive: true,
  });
  await Deno.mkdir(
    join(agentDir, "prompts", "steps", "continuation", "manual"),
    { recursive: true },
  );

  // Write templates
  await Deno.writeTextFile(
    join(agentDir, "agent.json"),
    agentTemplate(agentName),
  );

  await Deno.writeTextFile(
    join(agentDir, "config.json"),
    configTemplate(agentName),
  );

  await Deno.writeTextFile(
    join(agentDir, "steps_registry.json"),
    registryTemplate(),
  );

  await Deno.writeTextFile(
    join(agentDir, "prompts", "system.md"),
    systemPromptTemplate(agentName),
  );

  await Deno.writeTextFile(
    join(agentDir, "prompts", "steps", "initial", "manual", "f_default.md"),
    initialPromptTemplate(),
  );

  await Deno.writeTextFile(
    join(
      agentDir,
      "prompts",
      "steps",
      "continuation",
      "manual",
      "f_default.md",
    ),
    continuationPromptTemplate(),
  );

  console.log(`Agent '${agentName}' initialized at ${agentDir}`);
}
```

## Usage Examples

### Override via CLI

```bash
# Override permission mode
deno task agent:iterator --issue 123 --permission-mode plan

# Override max iterations
deno task agent:iterator --issue 123 --max-iterations 20
```

### Override via config.json

```json
{
  "version": "1.0.0",
  "overrides": {
    "permissionMode": "plan",
    "allowedTools": ["Read", "Glob", "Grep"]
  }
}
```

### Environment Override

```bash
# Enable debug logging
CLIMPT_AGENTS_DEBUG=true deno task agent:iterator --issue 123

# Override log directory
CLIMPT_AGENTS_LOG_DIR=./logs deno task agent:iterator --issue 123
```
