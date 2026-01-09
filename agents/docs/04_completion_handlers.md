# Completion Handlers Design

## Overview

Completion handlers determine when an agent should stop executing. They use the
Strategy pattern to provide different completion logic based on the agent's
`completionType` setting.

## Interface

```typescript
// agents/common/completion/types.ts

export interface CompletionHandler {
  /** Completion type identifier */
  readonly type: CompletionType;

  /** Build initial prompt for first iteration */
  buildInitialPrompt(args: Record<string, unknown>): Promise<string>;

  /** Build continuation prompt for subsequent iterations */
  buildContinuationPrompt(
    iteration: number,
    summaries: IterationSummary[],
  ): Promise<string>;

  /** Get completion criteria for system prompt */
  buildCompletionCriteria(): CompletionCriteria;

  /** Check if agent should complete */
  isComplete(summary: IterationSummary): Promise<boolean>;

  /** Get description of completion reason */
  getCompletionDescription(summary: IterationSummary): Promise<string>;
}

export interface CompletionCriteria {
  /** Short description (for logs) */
  short: string;
  /** Detailed description (for system prompt) */
  detailed: string;
}

export type CompletionType =
  | "issue"
  | "project"
  | "iterate"
  | "manual"
  | "custom";
```

## Factory

```typescript
// agents/common/completion/factory.ts

import type { AgentDefinition, CompletionHandler } from "./types.ts";
import { PromptResolver } from "../prompt-resolver.ts";
import { IssueCompletionHandler } from "./issue.ts";
import { ProjectCompletionHandler } from "./project.ts";
import { IterateCompletionHandler } from "./iterate.ts";
import { ManualCompletionHandler } from "./manual.ts";

export async function createCompletionHandler(
  definition: AgentDefinition,
  args: Record<string, unknown>,
): Promise<CompletionHandler> {
  const { completionType, completionConfig } = definition.behavior;

  // Create prompt resolver for handlers
  const promptResolver = await PromptResolver.create({
    agentName: definition.name,
    agentDir: `.agent/${definition.name}`,
    registryPath: definition.prompts.registry,
  });

  switch (completionType) {
    case "issue":
      return new IssueCompletionHandler({
        issueNumber: args.issue as number,
        promptResolver,
      });

    case "project":
      return new ProjectCompletionHandler({
        projectNumber: args.project as number,
        promptResolver,
        labels: definition.github?.labels,
      });

    case "iterate":
      return new IterateCompletionHandler({
        maxIterations: completionConfig.maxIterations!,
        promptResolver,
      });

    case "manual":
      return new ManualCompletionHandler({
        completionKeyword: completionConfig.completionKeyword!,
        promptResolver,
      });

    case "custom":
      return await loadCustomHandler(
        definition,
        completionConfig.handlerPath!,
        args,
      );

    default:
      throw new Error(`Unknown completion type: ${completionType}`);
  }
}

async function loadCustomHandler(
  definition: AgentDefinition,
  handlerPath: string,
  args: Record<string, unknown>,
): Promise<CompletionHandler> {
  const agentDir = `.agent/${definition.name}`;
  const fullPath = `${agentDir}/${handlerPath}`;

  const module = await import(fullPath);

  if (typeof module.default !== "function") {
    throw new Error("Custom handler must export default factory function");
  }

  return module.default(definition, args);
}
```

## Built-in Handlers

### IssueCompletionHandler

Completes when a GitHub Issue is closed.

```typescript
// agents/iterator/scripts/completion/issue.ts

import type {
  CompletionCriteria,
  CompletionHandler,
  IterationSummary,
} from "./types.ts";
import type { PromptResolver } from "../../common/prompt-resolver.ts";

export interface IssueHandlerOptions {
  issueNumber: number;
  promptResolver: PromptResolver;
}

export class IssueCompletionHandler implements CompletionHandler {
  readonly type = "issue" as const;
  private issueNumber: number;
  private promptResolver: PromptResolver;

  constructor(options: IssueHandlerOptions) {
    if (!options.issueNumber) {
      throw new Error("--issue <number> is required for issue completion type");
    }
    this.issueNumber = options.issueNumber;
    this.promptResolver = options.promptResolver;
  }

  async buildInitialPrompt(args: Record<string, unknown>): Promise<string> {
    return await this.promptResolver.resolve("initial_issue", {
      "uv-issue_number": String(this.issueNumber),
      ...this.argsToUvVars(args),
    });
  }

  async buildContinuationPrompt(
    iteration: number,
    summaries: IterationSummary[],
  ): Promise<string> {
    return await this.promptResolver.resolve("continuation_issue", {
      "uv-iteration": String(iteration),
      "uv-issue_number": String(this.issueNumber),
      "uv-previous_summary": this.formatSummaries(summaries.slice(-3)),
    });
  }

  buildCompletionCriteria(): CompletionCriteria {
    return {
      short: `Close Issue #${this.issueNumber}`,
      detailed:
        `Complete the requirements in GitHub Issue #${this.issueNumber} and close it when done. Use the 'gh issue close' command when all tasks are complete.`,
    };
  }

  async isComplete(summary: IterationSummary): Promise<boolean> {
    try {
      const result = await new Deno.Command("gh", {
        args: ["issue", "view", String(this.issueNumber), "--json", "state"],
        stdout: "piped",
        stderr: "piped",
      }).output();

      if (!result.success) {
        return false;
      }

      const output = new TextDecoder().decode(result.stdout);
      const data = JSON.parse(output);
      return data.state === "CLOSED";
    } catch {
      return false;
    }
  }

  async getCompletionDescription(summary: IterationSummary): Promise<string> {
    return `Issue #${this.issueNumber} closed successfully`;
  }

  private argsToUvVars(args: Record<string, unknown>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(args)) {
      result[`uv-${key}`] = String(value);
    }
    return result;
  }

  private formatSummaries(summaries: IterationSummary[]): string {
    return summaries.map((s, i) =>
      `Iteration ${s.iteration}: ${
        s.assistantResponses.slice(-1)[0]?.substring(0, 200) ?? "..."
      }`
    ).join("\n");
  }
}
```

### IterateCompletionHandler

Completes after a fixed number of iterations.

```typescript
// agents/iterator/scripts/completion/iterate.ts

import type {
  CompletionCriteria,
  CompletionHandler,
  IterationSummary,
} from "./types.ts";
import type { PromptResolver } from "../../common/prompt-resolver.ts";

export interface IterateHandlerOptions {
  maxIterations: number;
  promptResolver: PromptResolver;
}

export class IterateCompletionHandler implements CompletionHandler {
  readonly type = "iterate" as const;
  private maxIterations: number;
  private currentIteration = 0;
  private promptResolver: PromptResolver;

  constructor(options: IterateHandlerOptions) {
    this.maxIterations = options.maxIterations;
    this.promptResolver = options.promptResolver;
  }

  async buildInitialPrompt(args: Record<string, unknown>): Promise<string> {
    return await this.promptResolver.resolve("initial_iterate", {
      "uv-max_iterations": String(this.maxIterations),
      ...this.argsToUvVars(args),
    });
  }

  async buildContinuationPrompt(
    iteration: number,
    summaries: IterationSummary[],
  ): Promise<string> {
    this.currentIteration = iteration;
    const remaining = this.maxIterations - iteration;

    return await this.promptResolver.resolve("continuation_iterate", {
      "uv-iteration": String(iteration),
      "uv-max_iterations": String(this.maxIterations),
      "uv-remaining": String(remaining),
    });
  }

  buildCompletionCriteria(): CompletionCriteria {
    return {
      short: `${this.maxIterations} iterations`,
      detailed:
        `This task will run for up to ${this.maxIterations} iterations. Report progress at each iteration and work towards completing the goal efficiently.`,
    };
  }

  async isComplete(summary: IterationSummary): Promise<boolean> {
    return this.currentIteration >= this.maxIterations;
  }

  async getCompletionDescription(summary: IterationSummary): Promise<string> {
    return `Completed ${this.currentIteration}/${this.maxIterations} iterations`;
  }

  private argsToUvVars(args: Record<string, unknown>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(args)) {
      result[`uv-${key}`] = String(value);
    }
    return result;
  }
}
```

### ManualCompletionHandler

Completes when LLM outputs a specific keyword.

```typescript
// agents/common/completion/manual.ts

import type {
  CompletionCriteria,
  CompletionHandler,
  IterationSummary,
} from "./types.ts";
import type { PromptResolver } from "../prompt-resolver.ts";

export interface ManualHandlerOptions {
  completionKeyword: string;
  promptResolver: PromptResolver;
}

export class ManualCompletionHandler implements CompletionHandler {
  readonly type = "manual" as const;
  private completionKeyword: string;
  private promptResolver: PromptResolver;

  constructor(options: ManualHandlerOptions) {
    this.completionKeyword = options.completionKeyword;
    this.promptResolver = options.promptResolver;
  }

  async buildInitialPrompt(args: Record<string, unknown>): Promise<string> {
    return await this.promptResolver.resolve("initial_manual", {
      "uv-completion_keyword": this.completionKeyword,
      ...this.argsToUvVars(args),
    });
  }

  async buildContinuationPrompt(
    iteration: number,
    summaries: IterationSummary[],
  ): Promise<string> {
    return await this.promptResolver.resolve("continuation_manual", {
      "uv-iteration": String(iteration),
      "uv-completion_keyword": this.completionKeyword,
    });
  }

  buildCompletionCriteria(): CompletionCriteria {
    return {
      short: `Output "${this.completionKeyword}" when done`,
      detailed:
        `When the task is complete, output "${this.completionKeyword}" to signal completion. Do not output this keyword until you are certain the task is fully complete.`,
    };
  }

  async isComplete(summary: IterationSummary): Promise<boolean> {
    return summary.assistantResponses.some(
      (response) => response.includes(this.completionKeyword),
    );
  }

  async getCompletionDescription(summary: IterationSummary): Promise<string> {
    return `Completion keyword "${this.completionKeyword}" detected`;
  }

  private argsToUvVars(args: Record<string, unknown>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(args)) {
      result[`uv-${key}`] = String(value);
    }
    return result;
  }
}
```

### ProjectCompletionHandler

Completes when project reaches final phase.

```typescript
// agents/iterator/scripts/completion/project.ts

import type {
  CompletionCriteria,
  CompletionHandler,
  IterationSummary,
} from "./types.ts";
import type { PromptResolver } from "../../common/prompt-resolver.ts";

const PHASES = ["preparation", "processing", "review", "complete"] as const;
type Phase = typeof PHASES[number];

export interface ProjectHandlerOptions {
  projectNumber: number;
  promptResolver: PromptResolver;
  labels?: Record<string, string>;
}

export class ProjectCompletionHandler implements CompletionHandler {
  readonly type = "project" as const;
  private projectNumber: number;
  private currentPhase: Phase = "preparation";
  private promptResolver: PromptResolver;
  private labels?: Record<string, string>;

  constructor(options: ProjectHandlerOptions) {
    if (!options.projectNumber) {
      throw new Error(
        "--project <number> is required for project completion type",
      );
    }
    this.projectNumber = options.projectNumber;
    this.promptResolver = options.promptResolver;
    this.labels = options.labels;
  }

  async buildInitialPrompt(args: Record<string, unknown>): Promise<string> {
    return await this.promptResolver.resolve("initial_project", {
      "uv-project_number": String(this.projectNumber),
      "uv-phase": this.currentPhase,
      ...this.argsToUvVars(args),
    });
  }

  async buildContinuationPrompt(
    iteration: number,
    summaries: IterationSummary[],
  ): Promise<string> {
    // Detect phase from previous responses
    this.detectPhaseFromSummary(summaries);

    return await this.promptResolver.resolve(
      `continuation_project_${this.currentPhase}`,
      {
        "uv-iteration": String(iteration),
        "uv-project_number": String(this.projectNumber),
        "uv-phase": this.currentPhase,
      },
    );
  }

  buildCompletionCriteria(): CompletionCriteria {
    return {
      short: `Complete project #${this.projectNumber}`,
      detailed: `Work through GitHub Project #${this.projectNumber} phases:
1. Preparation: Gather requirements, setup
2. Processing: Implement the main work
3. Review: Validate and review changes
4. Complete: Finalize and close

Move to the next phase when the current phase is complete.`,
    };
  }

  async isComplete(summary: IterationSummary): Promise<boolean> {
    return this.currentPhase === "complete";
  }

  async getCompletionDescription(summary: IterationSummary): Promise<string> {
    return `Project #${this.projectNumber} completed through all phases`;
  }

  private detectPhaseFromSummary(summaries: IterationSummary[]): void {
    const lastResponses = summaries.slice(-2).flatMap((s) =>
      s.assistantResponses
    );
    const content = lastResponses.join(" ").toLowerCase();

    // Simple phase detection
    if (
      content.includes("phase: complete") ||
      content.includes("project complete")
    ) {
      this.currentPhase = "complete";
    } else if (
      content.includes("phase: review") || content.includes("moving to review")
    ) {
      this.currentPhase = "review";
    } else if (
      content.includes("phase: processing") ||
      content.includes("starting implementation")
    ) {
      this.currentPhase = "processing";
    }
  }

  private argsToUvVars(args: Record<string, unknown>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(args)) {
      result[`uv-${key}`] = String(value);
    }
    return result;
  }
}
```

## Custom Handler Example

Users can create custom completion handlers in their agent directory:

```typescript
// .agent/facilitator/completion/custom-handler.ts

import type {
  AgentDefinition,
  CompletionCriteria,
  CompletionHandler,
  IterationSummary,
} from "jsr:@aidevtool/climpt/agents/common/types";

interface FacilitatorOptions {
  topic: string;
  targetDecisions: number;
}

/** Factory function - must be default export */
export default function createHandler(
  definition: AgentDefinition,
  args: Record<string, unknown>,
): CompletionHandler {
  return new FacilitatorCompletionHandler({
    topic: args.topic as string,
    targetDecisions: (args.targetDecisions as number) ?? 3,
  });
}

class FacilitatorCompletionHandler implements CompletionHandler {
  readonly type = "custom" as const;
  private topic: string;
  private targetDecisions: number;
  private decisionsFound = 0;

  constructor(options: FacilitatorOptions) {
    this.topic = options.topic;
    this.targetDecisions = options.targetDecisions;
  }

  async buildInitialPrompt(args: Record<string, unknown>): Promise<string> {
    return `
# Facilitation Session

## Topic
${this.topic}

## Goal
- Achieve ${this.targetDecisions} decisions
- Document action items
- Summarize key points

Begin the facilitation session.
    `;
  }

  async buildContinuationPrompt(
    iteration: number,
    summaries: IterationSummary[],
  ): Promise<string> {
    return `
Session continuing (Iteration ${iteration})

Current decisions: ${this.decisionsFound}/${this.targetDecisions}

Continue facilitating towards the goal.
    `;
  }

  buildCompletionCriteria(): CompletionCriteria {
    return {
      short: `${this.targetDecisions} decisions`,
      detailed:
        `Facilitate the discussion to achieve ${this.targetDecisions} clear decisions. Output each decision using the action format.`,
    };
  }

  async isComplete(summary: IterationSummary): Promise<boolean> {
    // Count decisions from detected actions
    const decisions = summary.detectedActions.filter(
      (a) => a.type === "decision",
    );
    this.decisionsFound += decisions.length;

    return this.decisionsFound >= this.targetDecisions;
  }

  async getCompletionDescription(summary: IterationSummary): Promise<string> {
    return `Achieved ${this.decisionsFound} decisions`;
  }
}
```

## agent.json Configuration

```json
{
  "behavior": {
    "completionType": "custom",
    "completionConfig": {
      "handlerPath": "completion/custom-handler.ts"
    }
  }
}
```

## Handler Registration (Optional)

For reusable custom handlers:

```typescript
// agents/common/completion/registry.ts

const customHandlers = new Map<string, HandlerFactory>();

export function registerCompletionHandler(
  type: string,
  factory: HandlerFactory,
): void {
  customHandlers.set(type, factory);
}

export function getRegisteredHandler(type: string): HandlerFactory | undefined {
  return customHandlers.get(type);
}
```

## Testing Handlers

```typescript
// tests/completion/iterate_test.ts

import { assertEquals } from "@std/assert";
import { IterateCompletionHandler } from "../../agents/iterator/scripts/completion/iterate.ts";

Deno.test("IterateCompletionHandler - completes after max iterations", async () => {
  const handler = new IterateCompletionHandler({
    maxIterations: 3,
    promptResolver: mockPromptResolver,
  });

  // Simulate iterations
  await handler.buildContinuationPrompt(1, []);
  assertEquals(await handler.isComplete(mockSummary), false);

  await handler.buildContinuationPrompt(2, []);
  assertEquals(await handler.isComplete(mockSummary), false);

  await handler.buildContinuationPrompt(3, []);
  assertEquals(await handler.isComplete(mockSummary), true);
});
```
