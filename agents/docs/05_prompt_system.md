# Prompt System Design

## Overview

The prompt system integrates with Climpt to resolve and render prompt templates.
It uses the C3L (Category/Classification/Chapter) path structure and UV variable
substitution provided by Climpt's breakdown engine.

## Architecture

```
+-------------------------------------------------------------------------+
|                         Prompt Resolution Flow                           |
+-------------------------------------------------------------------------+

  +--------------+
  | Step ID      |  e.g., "initial_issue"
  | (Logical ID) |
  +------+-------+
         |
         v
  +--------------+
  | Step Registry|  .agent/{name}/steps_registry.json
  | (Step Mapping|  -> Maps to C3L coordinates
  +------+-------+
         |
         v
  +----------------------------------------------------------+
  | C3L Path                                                   |
  | .agent/{name}/prompts/{c1}/{c2}/{c3}/f_{edition}.md        |
  | e.g., .agent/iterator/prompts/steps/initial/issue/f_default.md |
  +------+-----------------------------------------------------+
         |
         v
  +--------------+
  | Climpt Engine|  Template rendering, UV substitution
  | (via CLI)    |
  +------+-------+
         |
         v
  +--------------+
  | Rendered     |  Final prompt with variables replaced
  | Prompt       |
  +--------------+
```

## Directory Structure

```
.agent/{agent-name}/
+-- steps_registry.json          # Step -> C3L mapping
+-- prompts/
    +-- system.md                # System prompt
    +-- steps/                   # C3L: c1 = "steps"
        +-- initial/             # C3L: c2 = "initial"
        |   +-- issue/           # C3L: c3 = "issue"
        |   |   +-- f_default.md
        |   +-- iterate/         # C3L: c3 = "iterate"
        |   |   +-- f_default.md
        |   +-- manual/          # C3L: c3 = "manual"
        |       +-- f_default.md
        +-- continuation/        # C3L: c2 = "continuation"
            +-- issue/
            |   +-- f_default.md
            +-- iterate/
            |   +-- f_default.md
            +-- manual/
                +-- f_default.md
```

## Steps Registry

Maps logical step IDs to C3L paths and variables.

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
    "initial_issue": {
      "name": "Issue Initial Prompt",
      "c1": "steps",
      "c2": "initial",
      "c3": "issue",
      "edition": "default",
      "variables": ["uv-issue_number"]
    },
    "initial_iterate": {
      "name": "Iterate Initial Prompt",
      "c1": "steps",
      "c2": "initial",
      "c3": "iterate",
      "edition": "default",
      "variables": ["uv-max_iterations"]
    },
    "initial_manual": {
      "name": "Manual Initial Prompt",
      "c1": "steps",
      "c2": "initial",
      "c3": "manual",
      "edition": "default",
      "variables": ["uv-topic", "uv-completion_keyword"],
      "useStdin": true
    },
    "continuation_issue": {
      "name": "Issue Continuation Prompt",
      "c1": "steps",
      "c2": "continuation",
      "c3": "issue",
      "edition": "default",
      "variables": ["uv-iteration", "uv-issue_number"]
    },
    "continuation_iterate": {
      "name": "Iterate Continuation Prompt",
      "c1": "steps",
      "c2": "continuation",
      "c3": "iterate",
      "edition": "default",
      "variables": ["uv-iteration", "uv-max_iterations", "uv-remaining"]
    },
    "continuation_manual": {
      "name": "Manual Continuation Prompt",
      "c1": "steps",
      "c2": "continuation",
      "c3": "manual",
      "edition": "default",
      "variables": ["uv-iteration", "uv-completion_keyword"]
    }
  },
  "editions": {
    "default": "Standard",
    "detailed": "Detailed",
    "brief": "Brief"
  }
}
```

## PromptResolver Implementation

```typescript
// agents/common/prompt-resolver.ts

import { join } from "@std/path";

export interface PromptResolverOptions {
  agentName: string;
  agentDir: string;
  registryPath: string;
}

export interface StepRegistry {
  version: string;
  basePath: string;
  steps: Record<string, StepDefinition>;
  editions?: Record<string, string>;
}

export interface StepDefinition {
  name: string;
  path?: string; // Direct path (for system prompt)
  c1?: string; // C3L category
  c2?: string; // C3L classification
  c3?: string; // C3L chapter
  edition?: string; // Edition (default: "default")
  variables?: string[]; // Expected UV variables
  useStdin?: boolean; // Pass input via stdin
}

export class PromptResolver {
  private agentDir: string;
  private registry: StepRegistry;

  private constructor(agentDir: string, registry: StepRegistry) {
    this.agentDir = agentDir;
    this.registry = registry;
  }

  static async create(options: PromptResolverOptions): Promise<PromptResolver> {
    const registryPath = join(options.agentDir, options.registryPath);
    const content = await Deno.readTextFile(registryPath);
    const registry = JSON.parse(content) as StepRegistry;

    return new PromptResolver(options.agentDir, registry);
  }

  async resolve(
    stepId: string,
    variables: Record<string, string>,
  ): Promise<string> {
    const step = this.registry.steps[stepId];
    if (!step) {
      throw new Error(`Unknown step: ${stepId}`);
    }

    // Build path
    const promptPath = step.path ?? this.buildC3LPath(step);
    const fullPath = join(this.agentDir, this.registry.basePath, promptPath);

    // Use Climpt for rendering
    try {
      return await this.renderWithClimpt(fullPath, variables, step.useStdin);
    } catch (error) {
      // Fallback to direct file read with simple substitution
      return await this.renderFallback(fullPath, variables);
    }
  }

  async resolveSystemPrompt(
    variables: Record<string, string>,
  ): Promise<string> {
    return await this.resolve("system", variables);
  }

  private buildC3LPath(step: StepDefinition): string {
    if (!step.c1 || !step.c2 || !step.c3) {
      throw new Error(`Step requires c1, c2, c3 or path`);
    }

    const edition = step.edition ?? "default";
    return join(step.c1, step.c2, step.c3, `f_${edition}.md`);
  }

  private async renderWithClimpt(
    path: string,
    variables: Record<string, string>,
    useStdin?: boolean,
  ): Promise<string> {
    // Build Climpt CLI arguments
    const args = ["--return", path];

    for (const [key, value] of Object.entries(variables)) {
      if (key.startsWith("uv-")) {
        args.push(`--${key}`, value);
      }
    }

    const command = new Deno.Command("climpt", {
      args,
      stdin: useStdin ? "piped" : "null",
      stdout: "piped",
      stderr: "piped",
    });

    const process = command.spawn();

    if (useStdin && variables.input_text) {
      const writer = process.stdin.getWriter();
      await writer.write(new TextEncoder().encode(variables.input_text));
      await writer.close();
    }

    const output = await process.output();

    if (!output.success) {
      const stderr = new TextDecoder().decode(output.stderr);
      throw new Error(`Climpt rendering failed: ${stderr}`);
    }

    return new TextDecoder().decode(output.stdout);
  }

  private async renderFallback(
    path: string,
    variables: Record<string, string>,
  ): Promise<string> {
    const content = await Deno.readTextFile(path);

    // Simple template substitution
    return content.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
      const varKey = key.trim();
      return variables[varKey] ?? variables[`uv-${varKey}`] ?? `{{${key}}}`;
    });
  }
}
```

## Prompt Templates

### System Prompt Template

```markdown
<!-- .agent/{name}/prompts/system.md --> ---

## schema: prompt version: 1.0.0

# {{uv-agent_name}} Agent

You are operating as the **{{uv-agent_name}}** agent.

## Completion Criteria

{{uv-completion_criteria}}

## Guidelines

- Think step by step
- Report progress regularly
- Ask for clarification when needed
- Follow the completion criteria closely
```

### Initial Prompt Template (Manual)

```markdown
<!-- .agent/{name}/prompts/steps/initial/manual/f_default.md --> ---

## schema: prompt version: 1.0.0

# Session Start

## Topic

{{uv-topic}}

## Objective

{{input_text}}

---

Begin the session. When complete, output `{{uv-completion_keyword}}`.
```

### Continuation Prompt Template (Manual)

```markdown
<!-- .agent/{name}/prompts/steps/continuation/manual/f_default.md --> ---

## schema: prompt version: 1.0.0

# Continuation (Iteration {{uv-iteration}})

Continue working on the task.

When complete, output `{{uv-completion_keyword}}`.
```

### Initial Prompt Template (Iterate)

```markdown
<!-- .agent/{name}/prompts/steps/initial/iterate/f_default.md --> ---

## schema: prompt version: 1.0.0

# Task Start

This task will run for up to **{{uv-max_iterations}}** iterations.

## Objective

{{input_text}}

---

Begin iteration 1. Make progress and report what you accomplished.
```

### Continuation Prompt Template (Iterate)

```markdown
<!-- .agent/{name}/prompts/steps/continuation/iterate/f_default.md --> ---

## schema: prompt version: 1.0.0

# Iteration {{uv-iteration}} of {{uv-max_iterations}}

**Remaining iterations:** {{uv-remaining}}

Continue making progress. Report what you accomplished this iteration.
```

## UV Variables

UV (User Variable) variables are passed to Climpt for substitution:

| Variable                 | Description              | Example            |
| ------------------------ | ------------------------ | ------------------ |
| `uv-agent_name`          | Agent identifier         | `iterator`         |
| `uv-completion_criteria` | Completion criteria text | `Close Issue #123` |
| `uv-topic`               | User-provided topic      | `Q1 Planning`      |
| `uv-issue_number`        | GitHub Issue number      | `123`              |
| `uv-iteration`           | Current iteration        | `3`                |
| `uv-max_iterations`      | Maximum iterations       | `10`               |
| `uv-remaining`           | Remaining iterations     | `7`                |
| `uv-completion_keyword`  | Keyword for completion   | `TASK_COMPLETE`    |

## Climpt Integration

### Via CLI

```bash
# Render prompt with UV variables
climpt --return .agent/iterator/prompts/steps/initial/manual/f_default.md \
  --uv-topic "Q1 Planning" \
  --uv-completion_keyword "SESSION_COMPLETE"

# With stdin input
echo "Facilitate the discussion" | climpt --return ... --uv-topic "Q1 Planning"
```

### Via Programmatic API (if available)

```typescript
import { renderPrompt } from "@aidevtool/climpt";

const rendered = await renderPrompt({
  path: ".agent/iterator/prompts/steps/initial/manual/f_default.md",
  uvVariables: {
    "uv-topic": "Q1 Planning",
    "uv-completion_keyword": "SESSION_COMPLETE",
  },
  stdin: "Facilitate the discussion",
});
```

## Fallback Provider

When Climpt is unavailable, a fallback provider handles basic rendering:

```typescript
// agents/common/fallback-prompts.ts

export interface FallbackPromptProvider {
  get(stepId: string, variables: Record<string, string>): string;
}

export class DefaultFallbackProvider implements FallbackPromptProvider {
  private templates: Record<string, string> = {
    "initial_iterate": `
# Task Start

This task will run for up to {uv-max_iterations} iterations.

Begin working on the task and report progress.
    `,
    "continuation_iterate": `
# Iteration {uv-iteration}/{uv-max_iterations}

Remaining: {uv-remaining} iterations.

Continue making progress.
    `,
    "initial_manual": `
# Session Start

Topic: {uv-topic}

Begin the session. When complete, output "{uv-completion_keyword}".
    `,
    "continuation_manual": `
# Continuation (Iteration {uv-iteration})

Continue the session. When complete, output "{uv-completion_keyword}".
    `,
  };

  get(stepId: string, variables: Record<string, string>): string {
    const template = this.templates[stepId];
    if (!template) {
      throw new Error(`No fallback template for step: ${stepId}`);
    }

    // Simple variable substitution
    return template.replace(
      /\{([^}]+)\}/g,
      (_, key) => variables[key] ?? `{${key}}`,
    );
  }
}
```

## Best Practices

### Prompt Organization

1. **System Prompt**: Keep it focused on agent identity and behavior
2. **Initial Prompts**: Set up context and goals
3. **Continuation Prompts**: Focus on progress and next steps
4. **Use Editions**: Create variations (default, detailed, brief)

### Variable Naming

1. Use `uv-` prefix for all UV variables
2. Use snake_case for variable names
3. Document expected variables in steps_registry.json

### Template Writing

1. Use markdown for formatting
2. Include frontmatter for metadata
3. Keep prompts focused and clear
4. Avoid hardcoding values - use variables

## Testing Prompts

```typescript
// tests/prompts/resolver_test.ts

import { assertEquals } from "@std/assert";
import { PromptResolver } from "../../agents/common/prompt-resolver.ts";

Deno.test("PromptResolver - resolves initial manual prompt", async () => {
  const resolver = await PromptResolver.create({
    agentName: "test-agent",
    agentDir: "./fixtures/agent",
    registryPath: "steps_registry.json",
  });

  const prompt = await resolver.resolve("initial_manual", {
    "uv-topic": "Test Topic",
    "uv-completion_keyword": "DONE",
  });

  assertStringIncludes(prompt, "Test Topic");
  assertStringIncludes(prompt, "DONE");
});
```
