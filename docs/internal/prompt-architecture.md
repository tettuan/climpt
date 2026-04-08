# Prompt Architecture

Internal documentation for the prompt externalization system architecture.

## Overview

The prompt externalization system allows agents to:

1. Define prompts externally in `.agent/{agent}/prompts/`
2. Resolve prompts using C3L path conventions
3. Substitute variables at runtime

## Core Components

### 1. StepRegistry (`agents/common/step-registry.ts`)

Manages step definitions that map logical step IDs to prompt files.

#### StepDefinition Interface

```typescript
interface StepDefinition {
  stepId: string; // Unique identifier (e.g., "initial.issue")
  name: string; // Human-readable name
  c2: string; // C3L component (e.g., "initial")
  c3: string; // C3L component (e.g., "issue")
  edition: string; // Edition (e.g., "default", "preparation")
  adaptation?: string; // Optional variant (e.g., "empty", "done")
  fallbackKey: string; // Legacy key (retained in registry schema)
  uvVariables: string[]; // Required UV variable names
  usesStdin: boolean; // Whether step uses STDIN input
  description?: string; // Optional description
}
```

#### StepRegistry Interface

```typescript
interface StepRegistry {
  agentId: string; // Agent identifier
  version: string; // Registry version
  c1: string; // C3L c1 component (e.g., "steps")
  pathTemplate?: string; // Path template with adaptation
  pathTemplateNoAdaptation?: string; // Path template without adaptation
  steps: Record<string, StepDefinition>;
  userPromptsBase?: string; // Base path for user prompts
}
```

#### Key Functions

| Function                                        | Description                  |
| ----------------------------------------------- | ---------------------------- |
| `loadStepRegistry(agentId, agentsDir, options)` | Load registry from JSON file |
| `getStepDefinition(registry, stepId)`           | Get step by ID               |
| `getStepIds(registry)`                          | Get all step IDs             |
| `hasStep(registry, stepId)`                     | Check if step exists         |
| `createEmptyRegistry(agentId, c1, version)`     | Create new empty registry    |
| `addStepDefinition(registry, step)`             | Add step to registry         |
| `validateStepRegistry(registry)`                | Validate registry structure  |
| `serializeRegistry(registry, pretty)`           | Convert to JSON string       |
| `saveStepRegistry(registry, filePath)`          | Save to file                 |

### 2. PromptResolver (`agents/common/prompt-resolver.ts`)

Resolves prompts via breakdown (C3L) only. No fallback to embedded prompts.

#### PromptResolutionResult Interface

```typescript
interface PromptResolutionResult {
  content: string; // Resolved prompt content
  source: "user"; // Always "user" (C3L file)
  promptPath?: string; // Actual file path
  stepId: string; // Step ID that was resolved
  substitutedVariables?: Record<string, string>; // Variables substituted
}
```

#### PromptVariables Interface

```typescript
interface PromptVariables {
  uv?: Record<string, string>; // UV variables (without "uv-" prefix)
  inputText?: string; // STDIN input
  custom?: Record<string, string>; // Custom variables
}
```

#### PromptResolver Class

```typescript
class PromptResolver {
  constructor(
    registry: StepRegistry,
    options?: PromptResolverOptions,
  );

  async resolve(
    stepId: string,
    variables?: PromptVariables,
  ): Promise<PromptResolutionResult>;

  async canResolve(stepId: string): Promise<boolean>;

  getUserFilePath(stepId: string): string | undefined;
}
```

#### Resolution Flow

```
resolve(stepId, variables)
    │
    ├──▶ Get StepDefinition from registry
    │
    ├──▶ Resolve via C3LPromptLoader
    │       │
    │       ├── Build C3L path from step definition
    │       ├── Call runBreakdown with UV variables
    │       ├── Return if successful and has content
    │       ├── Throw PR-C3L-002 on non-file-not-found errors
    │       │     (UV undefined, frontmatter broken, YAML parse failure)
    │       └── Throw PR-C3L-004 if prompt file not found
    │
    └──▶ Process content
            │
            ├── Strip frontmatter (if enabled)
            ├── Substitute UV variables {uv-xxx}
            ├── Substitute {input_text}
            └── Substitute custom variables
```

### 3. C3LPromptLoader (`agents/common/c3l-prompt-loader.ts`)

Integrates with breakdown CLI to resolve prompts using C3L paths.

#### C3LPath Interface

```typescript
interface C3LPath {
  c1: string; // Domain (e.g., "steps")
  c2: string; // Action (e.g., "initial")
  c3: string; // Target (e.g., "issue")
  edition: string; // Edition (e.g., "default")
  adaptation?: string; // Optional adaptation
}
```

#### Usage

```typescript
const loader = new C3LPromptLoader({
  agentId: "iterator",
  configSuffix: "steps",
  workingDir: Deno.cwd(),
});

const result = await loader.load(
  { c1: "steps", c2: "initial", c3: "issue", edition: "default" },
  { uv: { issue: "123" } },
);
```

## File Structure

```
agents/
├── common/
│   ├── step-registry.ts          # StepRegistry implementation
│   ├── step-registry_test.ts     # StepRegistry tests
│   ├── prompt-resolver.ts        # PromptResolver implementation
│   ├── prompt-resolver_test.ts   # PromptResolver tests
│   ├── c3l-prompt-loader.ts      # C3L integration
│   └── c3l-prompt-loader_test.ts # C3L loader tests

.agent/
├── climpt/
│   └── config/
│       ├── iterator-steps-app.yml  # Iterator breakdown config
│       ├── iterator-steps-user.yml
│       ├── reviewer-dev-app.yml    # Reviewer breakdown config
│       └── reviewer-dev-user.yml
├── iterator/
│   ├── steps_registry.json       # Iterator step definitions
│   └── prompts/steps/            # Iterator prompts
├── reviewer/
│   ├── steps_registry.json       # Reviewer step definitions
│   └── prompts/steps/            # Reviewer prompts
└── facilitator/
    ├── steps_registry.json       # Facilitator step definitions
    └── prompts/steps/            # Facilitator prompts
```

## Adding a New Agent

### Step 1: Create Agent Directory

```bash
mkdir -p .agent/{agent-name}/prompts/steps
```

### Step 2: Create Steps Registry

Create `.agent/{agent-name}/steps_registry.json`:

```json
{
  "agentId": "my-agent",
  "version": "1.0.0",
  "userPromptsBase": ".agent/my-agent/prompts",
  "c1": "steps",
  "pathTemplate": "{c1}/{c2}/{c3}/f_{edition}_{adaptation}.md",
  "pathTemplateNoAdaptation": "{c1}/{c2}/{c3}/f_{edition}.md",
  "steps": {
    "initial.task": {
      "stepId": "initial.task",
      "name": "Initial Task Prompt",
      "c2": "initial",
      "c3": "task",
      "edition": "default",
      "fallbackKey": "task_initial_default",
      "uvVariables": ["task_id"],
      "usesStdin": false,
      "description": "Initial prompt for task processing"
    }
  }
}
```

### Step 3: Create Breakdown Config

Create `.agent/climpt/config/{agent-name}-steps-app.yml`:

```yaml
working_dir: ".agent/{agent-name}"
app_prompt:
  base_dir: "prompts/steps"
app_schema:
  base_dir: "schema/steps"
```

### Step 4: Create Prompt Files

Create prompts following the C3L path structure:

```
.agent/{agent-name}/prompts/steps/initial/task/f_default.md
```

### Step 5: Use PromptResolver

```typescript
import { loadStepRegistry } from "../common/step-registry.ts";
import { PromptResolver } from "../common/prompt-resolver.ts";

// Load registry
const registry = await loadStepRegistry("my-agent", ".agent");

// Create resolver
const resolver = new PromptResolver(registry, {
  configSuffix: "steps",
  workingDir: Deno.cwd(),
});

// Resolve prompt
const result = await resolver.resolve("initial.task", {
  uv: { task_id: "123" },
});

console.log(result.content); // Prompt content with variables substituted
console.log(result.source); // Always "user"
```

## Variable Substitution

### UV Variables

UV variables use the format `{uv-name}`:

```markdown
Working on issue #{uv-issue} in project {uv-project_title}.
```

Runtime substitution:

```typescript
await resolver.resolve("stepId", {
  uv: {
    issue: "42",
    project_title: "My Project",
  },
});
```

### STDIN Input

For steps with `usesStdin: true`:

```markdown
Process the following input:

{input_text}
```

Runtime:

```typescript
await resolver.resolve("stepId", {
  inputText: "User provided content here",
});
```

### Custom Variables

For runtime-generated content:

```markdown
{project_context_section}

## Task Details

{issue_content}
```

Runtime:

```typescript
await resolver.resolve("stepId", {
  custom: {
    project_context_section: "## Context\nThis is part of project X...",
    issue_content: "Issue body from GitHub API...",
  },
});
```

## Frontmatter Processing

### Removal

By default, YAML frontmatter is stripped:

```markdown
---
stepId: initial.issue
name: Issue Prompt
---

Content after frontmatter...
```

Becomes:

```
Content after frontmatter...
```

Disable with:

```typescript
const resolver = new PromptResolver(registry, {
  stripFrontmatter: false,
});
```

### Parsing

Use `parseFrontmatter()` for metadata extraction:

```typescript
import { parseFrontmatter } from "../common/prompt-resolver.ts";

const frontmatter = parseFrontmatter(content);
// { stepId: "initial.issue", name: "Issue Prompt" }
```

## Error Handling

### Missing Step

```typescript
// Throws: Error("Unknown step ID: \"unknown.step\"")
await resolver.resolve("unknown.step");
```

### Missing Required Variable

```typescript
// Throws: Error("Missing required UV variable \"issue\" for step \"initial.issue\"")
await resolver.resolve("initial.issue", { uv: {} });
```

### Allow Missing Variables

```typescript
const resolver = new PromptResolver(registry, {
  allowMissingVariables: true,
});

// Variables become empty strings instead of throwing
await resolver.resolve("initial.issue", { uv: {} });
```

### C3L Prompt File Not Found (PR-C3L-004)

```typescript
// Throws PR-C3L-004 when the C3L prompt file does not exist on disk.
// This is the only outcome when a prompt cannot be resolved - there is no fallback.
await resolver.resolve("step.with.missing.file");
```

### C3L Breakdown Failed (PR-C3L-002)

```typescript
// Throws PR-C3L-002 on non-file-not-found C3L errors:
// UV undefined, frontmatter broken, YAML parse failure, etc.
// These require user correction.
await resolver.resolve("step.with.broken.template");
```

## Testing

### Unit Tests

Test step registry operations:

```typescript
Deno.test("getStepDefinition - returns step by ID", () => {
  const registry = createEmptyRegistry("test-agent");
  addStepDefinition(registry, { ... });

  const step = getStepDefinition(registry, "initial.test");
  assertEquals(step?.name, "Test Step");
});
```

Test prompt resolution (C3L only):

```typescript
Deno.test("PromptResolver - throws PR-C3L-004 when file missing", async () => {
  const registry = createEmptyRegistry("test-agent");
  addStepDefinition(registry, { ... });

  const resolver = new PromptResolver(registry, {
    workingDir: "/nonexistent",
  });

  await assertRejects(
    () => resolver.resolve("step.id"),
    Error,
    "PR-C3L-004",
  );
});
```

### Integration Tests

Test with real breakdown integration:

```typescript
Deno.test("Iterator prompt resolution", async () => {
  const registry = await loadStepRegistry("iterator", ".agent");
  const resolver = new PromptResolver(registry);

  const result = await resolver.resolve("initial.issue", {
    uv: { issue: "123" },
    custom: { issue_content: "Test content" },
  });

  assertEquals(result.source, "user");
  assertStringIncludes(result.content, "#123");
});
```

## Related Documentation

- [Prompt Customization Guide](../prompt-customization-guide.md)
- [Registry Specification](./registry-specification.md)
- [Iterator Agent Design](./iterate-agent-design.md)
- [C3L Integration](./iterate-agent-c3l-integration.md)
