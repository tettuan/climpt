# Agent Definition Schema

## Overview

The `agent.json` file defines an agent's behavior, parameters, and
configuration. It follows a declarative approach where agents are defined
through configuration rather than code.

## Schema Version

Current schema version: `1.0.0`

## Full Schema

```json
{
  "$schema": "https://raw.githubusercontent.com/tettuan/climpt/main/agents/schemas/agent.schema.json",
  "version": "1.0.0",

  "name": "string (required)",
  "displayName": "string (required)",
  "description": "string (required)",

  "behavior": {
    "systemPromptPath": "string (required)",
    "completionType": "issue | project | iterate | manual | custom",
    "completionConfig": { "..." },
    "allowedTools": ["string"],
    "permissionMode": "plan | acceptEdits | bypassPermissions"
  },

  "parameters": {
    "paramName": {
      "type": "string | number | boolean | array",
      "description": "string",
      "required": "boolean",
      "default": "any",
      "cli": "string",
      "validation": { "..." }
    }
  },

  "prompts": {
    "registry": "string",
    "fallbackDir": "string"
  },

  "actions": {
    "enabled": "boolean",
    "types": ["string"],
    "outputFormat": "string",
    "handlers": { "..." }
  },

  "github": {
    "enabled": "boolean",
    "labels": { "..." }
  },

  "worktree": {
    "enabled": "boolean",
    "root": "string"
  },

  "logging": {
    "directory": "string",
    "format": "jsonl | text",
    "maxFiles": "number"
  }
}
```

## Section Details

### Root Fields

| Field         | Type   | Required | Description                              |
| ------------- | ------ | -------- | ---------------------------------------- |
| `$schema`     | string | No       | JSON Schema URL for validation           |
| `version`     | string | Yes      | Schema version (semver)                  |
| `name`        | string | Yes      | Agent identifier (lowercase, kebab-case) |
| `displayName` | string | Yes      | Human-readable name                      |
| `description` | string | Yes      | Agent description                        |

### behavior

Defines how the agent behaves during execution.

```typescript
interface AgentBehavior {
  // Path to system prompt (relative to .agent/{name}/)
  systemPromptPath: string;

  // How the agent determines completion
  completionType: "issue" | "project" | "iterate" | "manual" | "custom";

  // Configuration for the completion type
  completionConfig: CompletionConfig;

  // Tools the agent is allowed to use
  allowedTools: string[];

  // Claude permission mode
  permissionMode: "plan" | "acceptEdits" | "bypassPermissions";
}
```

#### completionType

| Type      | Description                          | Required Config                |
| --------- | ------------------------------------ | ------------------------------ |
| `issue`   | Complete when GitHub Issue is closed | None (issue number from CLI)   |
| `project` | Complete when project phase ends     | None (project number from CLI) |
| `iterate` | Complete after N iterations          | `maxIterations: number`        |
| `manual`  | Complete on keyword output           | `completionKeyword: string`    |
| `custom`  | Custom handler                       | `handlerPath: string`          |

#### completionConfig Examples

```json
// iterate
{
  "completionType": "iterate",
  "completionConfig": {
    "maxIterations": 10
  }
}

// manual
{
  "completionType": "manual",
  "completionConfig": {
    "completionKeyword": "TASK_COMPLETE"
  }
}

// custom
{
  "completionType": "custom",
  "completionConfig": {
    "handlerPath": "completion/my-handler.ts"
  }
}
```

### parameters

Defines CLI parameters the agent accepts.

```typescript
interface ParameterDefinition {
  type: "string" | "number" | "boolean" | "array";
  description: string;
  required: boolean;
  default?: unknown;
  cli: string; // CLI flag (e.g., "--topic")
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    enum?: string[];
  };
}
```

#### Example

```json
{
  "parameters": {
    "topic": {
      "type": "string",
      "description": "Topic for the session",
      "required": true,
      "cli": "--topic"
    },
    "maxIterations": {
      "type": "number",
      "description": "Maximum iterations",
      "required": false,
      "default": 10,
      "cli": "--max-iterations",
      "validation": {
        "min": 1,
        "max": 100
      }
    },
    "mode": {
      "type": "string",
      "description": "Operation mode",
      "required": false,
      "default": "standard",
      "cli": "--mode",
      "validation": {
        "enum": ["standard", "detailed", "brief"]
      }
    }
  }
}
```

### prompts

Configuration for prompt resolution.

```typescript
interface PromptConfig {
  // Path to steps registry JSON
  registry: string;

  // Fallback directory for prompts
  fallbackDir: string;
}
```

### actions

Configuration for the action system.

```typescript
interface ActionConfig {
  // Enable action detection and execution
  enabled: boolean;

  // Allowed action types
  types: string[];

  // Markdown code block marker format
  outputFormat: string;

  // Handler mapping (type -> handler)
  handlers?: Record<string, string>;
}
```

#### Handler Specifications

Handlers can be:

- `builtin:log` - Log to console/file
- `builtin:github-issue` - Create GitHub Issue
- `builtin:github-comment` - Add comment to Issue
- `builtin:file` - Write to file
- Custom path (e.g., `actions/my-handler.ts`)

### github

GitHub integration settings.

```typescript
interface GitHubConfig {
  enabled: boolean;
  labels?: Record<string, string>;
}
```

### worktree

Git worktree settings for isolated work.

```typescript
interface WorktreeConfig {
  enabled: boolean;
  root?: string;
}
```

### logging

Logging configuration.

```typescript
interface LoggingConfig {
  directory: string;
  format: "jsonl" | "text";
  maxFiles?: number;
}
```

## Complete Example

```json
{
  "$schema": "https://raw.githubusercontent.com/tettuan/climpt/main/agents/schemas/agent.schema.json",
  "version": "1.0.0",

  "name": "facilitator",
  "displayName": "Facilitator Agent",
  "description": "Meeting facilitation and decision tracking agent",

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
      "description": "Facilitation topic",
      "required": true,
      "cli": "--topic"
    },
    "participants": {
      "type": "number",
      "description": "Number of participants",
      "required": false,
      "default": 5,
      "cli": "--participants"
    },
    "targetDecisions": {
      "type": "number",
      "description": "Target number of decisions",
      "required": false,
      "default": 3,
      "cli": "--target-decisions"
    },
    "outputFile": {
      "type": "string",
      "description": "Output file for meeting notes",
      "required": false,
      "default": "meeting-notes.md",
      "cli": "--output"
    }
  },

  "prompts": {
    "registry": "steps_registry.json",
    "fallbackDir": "prompts/"
  },

  "actions": {
    "enabled": true,
    "types": ["decision", "action-item", "note", "question", "summary"],
    "outputFormat": "facilitator-action",
    "handlers": {
      "decision": "builtin:log",
      "action-item": "builtin:log",
      "note": "builtin:log",
      "question": "builtin:log",
      "summary": "builtin:log"
    }
  },

  "github": {
    "enabled": false
  },

  "worktree": {
    "enabled": false
  },

  "logging": {
    "directory": "tmp/logs/agents/facilitator",
    "format": "jsonl",
    "maxFiles": 50
  }
}
```

## TypeScript Type Definitions

```typescript
// agents/common/types.ts

export interface AgentDefinition {
  $schema?: string;
  version: string;

  name: string;
  displayName: string;
  description: string;

  behavior: AgentBehavior;
  parameters: Record<string, ParameterDefinition>;
  prompts: PromptConfig;
  actions?: ActionConfig;
  github?: GitHubConfig;
  worktree?: WorktreeConfig;
  logging: LoggingConfig;
}

export interface AgentBehavior {
  systemPromptPath: string;
  completionType: CompletionType;
  completionConfig: CompletionConfigUnion;
  allowedTools: string[];
  permissionMode: PermissionMode;
}

export type CompletionType =
  | "issue"
  | "project"
  | "iterate"
  | "manual"
  | "custom";

export type CompletionConfigUnion =
  | IssueCompletionConfig
  | ProjectCompletionConfig
  | IterateCompletionConfig
  | ManualCompletionConfig
  | CustomCompletionConfig;

export interface IssueCompletionConfig {
  type: "issue";
}

export interface ProjectCompletionConfig {
  type: "project";
}

export interface IterateCompletionConfig {
  type: "iterate";
  maxIterations: number;
}

export interface ManualCompletionConfig {
  type: "manual";
  completionKeyword: string;
}

export interface CustomCompletionConfig {
  type: "custom";
  handlerPath: string;
}

export type PermissionMode = "plan" | "acceptEdits" | "bypassPermissions";

export interface ParameterDefinition {
  type: "string" | "number" | "boolean" | "array";
  description: string;
  required: boolean;
  default?: unknown;
  cli: string;
  validation?: ParameterValidation;
}

export interface ParameterValidation {
  min?: number;
  max?: number;
  pattern?: string;
  enum?: string[];
}

export interface PromptConfig {
  registry: string;
  fallbackDir: string;
}

export interface ActionConfig {
  enabled: boolean;
  types: string[];
  outputFormat: string;
  handlers?: Record<string, string>;
}

export interface GitHubConfig {
  enabled: boolean;
  labels?: Record<string, string>;
}

export interface WorktreeConfig {
  enabled: boolean;
  root?: string;
}

export interface LoggingConfig {
  directory: string;
  format: "jsonl" | "text";
  maxFiles?: number;
}
```

## Validation

Agent definitions are validated at load time:

1. **Schema Validation**: JSON Schema validation
2. **Required Fields**: Check all required fields are present
3. **Type Validation**: Verify field types match schema
4. **Cross-field Validation**: Check completionConfig matches completionType
5. **Path Validation**: Verify referenced files exist

```typescript
// agents/common/loader.ts

export function validateAgentDefinition(
  def: AgentDefinition,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required fields
  if (!def.name) errors.push("name is required");
  if (!def.displayName) errors.push("displayName is required");
  if (!def.behavior?.completionType) {
    errors.push("behavior.completionType is required");
  }

  // CompletionConfig validation
  switch (def.behavior.completionType) {
    case "iterate":
      if (!def.behavior.completionConfig?.maxIterations) {
        errors.push("maxIterations required for iterate completion type");
      }
      break;
    case "manual":
      if (!def.behavior.completionConfig?.completionKeyword) {
        errors.push("completionKeyword required for manual completion type");
      }
      break;
    case "custom":
      if (!def.behavior.completionConfig?.handlerPath) {
        errors.push("handlerPath required for custom completion type");
      }
      break;
  }

  // Parameter validation
  for (const [name, param] of Object.entries(def.parameters ?? {})) {
    if (!param.cli) {
      errors.push(`Parameter '${name}' missing cli flag`);
    }
    if (param.required && param.default !== undefined) {
      warnings.push(`Parameter '${name}' is required but has default value`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
```

## JSON Schema

The JSON Schema file is available at: `agents/schemas/agent.schema.json`

Use it in your agent.json for IDE support:

```json
{
  "$schema": "https://raw.githubusercontent.com/tettuan/climpt/main/agents/schemas/agent.schema.json",
  "version": "1.0.0",
  "name": "my-agent"
}
```
