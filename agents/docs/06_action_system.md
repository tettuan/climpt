# Action System Design

## Overview

The action system allows agents to output structured data that can be
automatically detected and processed. Actions are formatted as JSON within
markdown code blocks.

## Architecture

````
+-------------------------------------------------------------------------+
|                          Action Flow                                     |
+-------------------------------------------------------------------------+

  LLM Output                      Detection                   Execution
  +--------------+              +--------------+           +--------------+
  | ```action    |              | Action       |           | Action       |
  | {...}        |  -------->   | Detector     |  ------>  | Executor     |
  | ```          |              +--------------+           +--------------+
  +--------------+                     |                          |
                                       v                          v
                                +--------------+           +--------------+
                                | Detected     |           | Execution    |
                                | Actions      |           | Results      |
                                +--------------+           +--------------+
````

## Configuration

Actions are configured in `agent.json`:

```json
{
  "actions": {
    "enabled": true,
    "types": ["decision", "action-item", "note", "question"],
    "outputFormat": "facilitator-action",
    "handlers": {
      "decision": "builtin:log",
      "action-item": "builtin:github-issue",
      "note": "builtin:log",
      "question": "builtin:log"
    }
  }
}
```

| Field          | Type     | Description                  |
| -------------- | -------- | ---------------------------- |
| `enabled`      | boolean  | Enable/disable action system |
| `types`        | string[] | Allowed action types         |
| `outputFormat` | string   | Markdown code block marker   |
| `handlers`     | object   | Type -> handler mapping      |

## Type Definitions

```typescript
// agents/common/actions/types.ts

/** Action configuration from agent.json */
export interface ActionConfig {
  enabled: boolean;
  types: string[];
  outputFormat: string;
  handlers?: Record<string, string>;
}

/** Detected action from LLM output */
export interface DetectedAction {
  type: string;
  content: string;
  metadata: Record<string, unknown>;
  raw: string;
}

/** Result of action execution */
export interface ActionResult {
  action: DetectedAction;
  success: boolean;
  result?: unknown;
  error?: string;
}

/** Action handler interface */
export interface ActionHandler {
  readonly type: string;
  canHandle(action: DetectedAction): boolean;
  execute(
    action: DetectedAction,
    context: ActionContext,
  ): Promise<ActionResult>;
}

/** Context passed to handlers */
export interface ActionContext {
  agentName: string;
  iteration: number;
  logger: Logger;
  cwd: string;
  github?: GitHubContext;
}
```

## Action Detector

````typescript
// agents/common/actions/detector.ts

export class ActionDetector {
  private outputFormat: string;
  private allowedTypes: Set<string>;

  constructor(config: ActionConfig) {
    this.outputFormat = config.outputFormat;
    this.allowedTypes = new Set(config.types);
  }

  detect(content: string): DetectedAction[] {
    const actions: DetectedAction[] = [];

    // Match: ```{outputFormat}\n{json}\n```
    const regex = new RegExp(
      `\`\`\`${this.escapeRegex(this.outputFormat)}\\n([\\s\\S]*?)\\n\`\`\``,
      "g",
    );

    let match;
    while ((match = regex.exec(content)) !== null) {
      const raw = match[1].trim();

      try {
        const parsed = JSON.parse(raw);

        // Validate type
        if (!parsed.type || !this.allowedTypes.has(parsed.type)) {
          continue;
        }

        actions.push({
          type: parsed.type,
          content: parsed.content ?? "",
          metadata: this.extractMetadata(parsed),
          raw,
        });
      } catch {
        // Skip invalid JSON
      }
    }

    return actions;
  }

  private extractMetadata(
    parsed: Record<string, unknown>,
  ): Record<string, unknown> {
    const { type, content, ...metadata } = parsed;
    return metadata;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}
````

## Action Executor

```typescript
// agents/common/actions/executor.ts

import {
  ActionConfig,
  ActionContext,
  ActionHandler,
  ActionResult,
  DetectedAction,
} from "./types.ts";
import { LogActionHandler } from "./handlers/log.ts";
import { GitHubIssueHandler } from "./handlers/github_issue.ts";
import { FileActionHandler } from "./handlers/file.ts";

export class ActionExecutor {
  private handlers: Map<string, ActionHandler>;
  private context: ActionContext;

  constructor(config: ActionConfig, context: Omit<ActionContext, "iteration">) {
    this.context = { ...context, iteration: 0 };
    this.handlers = this.initializeHandlers(config);
  }

  private initializeHandlers(config: ActionConfig): Map<string, ActionHandler> {
    const handlers = new Map<string, ActionHandler>();

    for (const [type, handlerSpec] of Object.entries(config.handlers ?? {})) {
      handlers.set(type, this.createHandler(handlerSpec, type));
    }

    // Default handlers for unspecified types
    for (const type of config.types) {
      if (!handlers.has(type)) {
        handlers.set(type, new LogActionHandler(type));
      }
    }

    return handlers;
  }

  private createHandler(spec: string, type: string): ActionHandler {
    if (spec.startsWith("builtin:")) {
      const builtin = spec.replace("builtin:", "");
      switch (builtin) {
        case "log":
          return new LogActionHandler(type);
        case "github-issue":
          return new GitHubIssueHandler(type);
        case "github-comment":
          return new GitHubCommentHandler(type);
        case "file":
          return new FileActionHandler(type);
        default:
          throw new Error(`Unknown builtin handler: ${builtin}`);
      }
    }

    // Custom handler path
    return new DynamicHandler(spec, type);
  }

  setIteration(iteration: number): void {
    this.context.iteration = iteration;
  }

  async execute(actions: DetectedAction[]): Promise<ActionResult[]> {
    const results: ActionResult[] = [];

    for (const action of actions) {
      const handler = this.handlers.get(action.type);

      if (!handler) {
        results.push({
          action,
          success: false,
          error: `No handler for action type: ${action.type}`,
        });
        continue;
      }

      try {
        const result = await handler.execute(action, this.context);
        results.push(result);

        this.context.logger.info(`[Action: ${action.type}]`, {
          success: result.success,
          content: action.content.substring(0, 100),
        });
      } catch (error) {
        results.push({
          action,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });

        this.context.logger.error(`[Action: ${action.type}] Failed`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }
}
```

## Built-in Handlers

### LogActionHandler

Logs actions to console and log file.

```typescript
// agents/common/actions/handlers/log.ts

export class LogActionHandler implements ActionHandler {
  readonly type: string;

  constructor(type: string) {
    this.type = type;
  }

  canHandle(action: DetectedAction): boolean {
    return action.type === this.type;
  }

  async execute(
    action: DetectedAction,
    context: ActionContext,
  ): Promise<ActionResult> {
    context.logger.info(`[Action: ${action.type}]`, {
      content: action.content,
      metadata: action.metadata,
    });

    return {
      action,
      success: true,
      result: { logged: true },
    };
  }
}
```

### GitHubIssueHandler

Creates GitHub Issues.

```typescript
// agents/common/actions/handlers/github_issue.ts

export class GitHubIssueHandler implements ActionHandler {
  readonly type: string;

  constructor(type: string) {
    this.type = type;
  }

  canHandle(action: DetectedAction): boolean {
    return action.type === this.type;
  }

  async execute(
    action: DetectedAction,
    context: ActionContext,
  ): Promise<ActionResult> {
    const { content, metadata } = action;

    const title = (metadata.title as string) ?? content.substring(0, 50);
    const body = this.buildBody(action);
    const labels = (metadata.labels as string[]) ?? [];
    const assignees = metadata.assignee ? [metadata.assignee as string] : [];

    const args = [
      "issue",
      "create",
      "--title",
      title,
      "--body",
      body,
    ];

    if (labels.length > 0) {
      args.push("--label", labels.join(","));
    }
    if (assignees.length > 0) {
      args.push("--assignee", assignees.join(","));
    }

    const result = await new Deno.Command("gh", {
      args,
      stdout: "piped",
      stderr: "piped",
      cwd: context.cwd,
    }).output();

    if (!result.success) {
      const stderr = new TextDecoder().decode(result.stderr);
      return {
        action,
        success: false,
        error: `Failed to create issue: ${stderr}`,
      };
    }

    const output = new TextDecoder().decode(result.stdout);
    const issueUrl = output.trim();

    context.logger.info(`[Action: ${action.type}] Issue created`, {
      url: issueUrl,
    });

    return {
      action,
      success: true,
      result: { issueUrl },
    };
  }

  private buildBody(action: DetectedAction): string {
    const parts = [action.content];

    if (action.metadata.rationale) {
      parts.push(`\n## Rationale\n${action.metadata.rationale}`);
    }
    if (action.metadata.dueDate) {
      parts.push(`\n**Due Date:** ${action.metadata.dueDate}`);
    }
    if (action.metadata.priority) {
      parts.push(`\n**Priority:** ${action.metadata.priority}`);
    }

    return parts.join("\n");
  }
}
```

### FileActionHandler

Writes or appends to files.

```typescript
// agents/common/actions/handlers/file.ts

import { join } from "@std/path";

export class FileActionHandler implements ActionHandler {
  readonly type: string;

  constructor(type: string) {
    this.type = type;
  }

  canHandle(action: DetectedAction): boolean {
    return action.type === this.type;
  }

  async execute(
    action: DetectedAction,
    context: ActionContext,
  ): Promise<ActionResult> {
    const { content, metadata } = action;
    const filename = (metadata.filename as string) ?? "output.md";
    const mode = (metadata.mode as "write" | "append") ?? "append";

    const filePath = join(context.cwd, filename);

    try {
      if (mode === "append") {
        await Deno.writeTextFile(filePath, content + "\n", { append: true });
      } else {
        await Deno.writeTextFile(filePath, content);
      }

      context.logger.info(`[Action: ${action.type}] File written`, {
        path: filePath,
        mode,
      });

      return {
        action,
        success: true,
        result: { path: filePath, mode },
      };
    } catch (error) {
      return {
        action,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
```

## LLM Output Format

Agents instruct the LLM to output actions in the configured format:

````markdown
I've made a decision:

```facilitator-action
{
  "type": "decision",
  "content": "We will use TypeScript for the project",
  "rationale": "Better type safety and IDE support",
  "participants": ["Alice", "Bob"]
}
```
````

Here's an action item:

```facilitator-action
{
  "type": "action-item",
  "content": "Set up TypeScript configuration",
  "assignee": "Alice",
  "dueDate": "2024-01-20",
  "priority": "high"
}
```

## Action Types Examples

### decision

```json
{
  "type": "decision",
  "content": "Decision content",
  "rationale": "Why this was decided",
  "participants": ["Person1", "Person2"]
}
```

### action-item

```json
{
  "type": "action-item",
  "content": "Task to be done",
  "assignee": "Person",
  "dueDate": "YYYY-MM-DD",
  "priority": "high|medium|low"
}
```

### note

```json
{
  "type": "note",
  "content": "Important note",
  "category": "insight|concern|idea"
}
```

### question

```json
{
  "type": "question",
  "content": "Question that needs answering",
  "context": "Background information"
}
```

### summary

```json
{
  "type": "summary",
  "decisionsCount": 3,
  "actionItemsCount": 5,
  "openQuestions": ["Question 1"],
  "nextSteps": ["Step 1"]
}
```

## Custom Handlers

Create custom handlers in the agent directory:

```typescript
// .agent/facilitator/actions/decision-handler.ts

import type {
  ActionContext,
  ActionHandler,
  ActionResult,
  DetectedAction,
} from "jsr:@aidevtool/climpt/agents/common/types";
import { join } from "@std/path";

export default class DecisionHandler implements ActionHandler {
  readonly type = "decision";

  canHandle(action: DetectedAction): boolean {
    return action.type === "decision";
  }

  async execute(
    action: DetectedAction,
    context: ActionContext,
  ): Promise<ActionResult> {
    // Custom logic: Write to a decision log file
    const logPath = join(context.cwd, "decisions.md");

    const entry = `
## ${new Date().toISOString()} - Decision

**Content:** ${action.content}

**Rationale:** ${action.metadata.rationale ?? "Not specified"}

**Participants:** ${(action.metadata.participants as string[] ?? []).join(", ")}

---
`;

    await Deno.writeTextFile(logPath, entry, { append: true });

    context.logger.info(`[Decision] Logged to ${logPath}`);

    return {
      action,
      success: true,
      result: { file: logPath },
    };
  }
}
```

Configure in `agent.json`:

```json
{
  "actions": {
    "handlers": {
      "decision": "actions/decision-handler.ts"
    }
  }
}
```

## Action Schemas (Optional)

Define JSON schemas for action validation:

```json
// .agent/facilitator/actions/schemas/decision.json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["type", "content"],
  "properties": {
    "type": { "const": "decision" },
    "content": { "type": "string", "description": "Decision content" },
    "rationale": { "type": "string", "description": "Decision rationale" },
    "participants": {
      "type": "array",
      "items": { "type": "string" },
      "description": "People involved"
    }
  }
}
```

## Built-in Handler Reference

| Handler                  | Spec                 | Description |
| ------------------------ | -------------------- | ----------- |
| `builtin:log`            | Log to console/file  |             |
| `builtin:github-issue`   | Create GitHub Issue  |             |
| `builtin:github-comment` | Add comment to Issue |             |
| `builtin:github-close`   | Close GitHub Issue   |             |
| `builtin:file`           | Write/append to file |             |
| `builtin:notify`         | Send notification    |             |

## Integration with Runner

```typescript
// In AgentRunner.executeQuery()

if (this.actionDetector && message.type === "assistant") {
  const actions = this.actionDetector.detect(message.message.content);
  summary.detectedActions.push(...actions);
}

// After query completes
if (this.actionExecutor && summary.detectedActions.length > 0) {
  this.actionExecutor.setIteration(iteration);
  summary.actionResults = await this.actionExecutor.execute(
    summary.detectedActions,
  );
}
```
