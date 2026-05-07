# Prompt Architecture

Internal documentation for the prompt externalization system architecture.

## Overview

The prompt externalization system allows agents to:

1. Define prompts externally in `.agent/{agent}/prompts/`
2. Resolve prompts using C3L path conventions
3. Substitute variables at runtime

## Design Boundary: C3L Logical Coordinates vs Physical Path

Runner and Breakdown have distinct responsibilities separated by a clear
boundary:

| Layer                            | Owns                                                        | Does NOT own               |
| -------------------------------- | ----------------------------------------------------------- | -------------------------- |
| **Runner** (steps_registry.json) | C3L logical coordinates: c1, c2, c3, edition, adaptation    | Physical file paths        |
| **Breakdown** (app.yml)          | Physical path resolution: working_dir + app_prompt.base_dir | Step flow, UV declarations |

**Runner** knows WHAT to resolve — the C3L coordinates that identify a prompt
logically. **Breakdown** knows WHERE the file lives — the physical path derived
from app.yml configuration.

The boundary is `C3LPromptLoader.load()`: Runner passes C3L coordinates and a
config name, Breakdown reads app.yml to resolve the physical file, and returns
content.

Runner does not hold, construct, or log physical file paths. Log and error
messages use C3L coordinate notation (e.g., `steps/initial/issue/f_default.md`).

## C3L Component Roles

### Principle

c1 scopes configuration, not path resolution. Because config is selected per
`{agentId, c1}` pair, the corresponding `base_dir` already points to the
c1-scoped directory. Breakdown resolves paths as
`{base_dir}/{c2}/{c3}/f_{edition}.md` — c1 does not appear as a separate path
segment.

### Connection Points

Each C3L component (c1, c2, c3) connects to the system at specific points.

| # | Component | Connects to           | Mechanism                                                                                            | Guarantee                                                            |
| - | --------- | --------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1 | c1        | Config file selection | `steps_registry.json` declares `c1`; config name = `{agentId}-{c1}` → loads `{agentId}-{c1}-app.yml` | One config per {agentId, c1} pair                                    |
| 2 | c1        | `base_dir` in app.yml | `base_dir: "prompts/{c1}"` (e.g., `"prompts/steps"`)                                                 | c1 is absorbed into base_dir, not passed to breakdown as a parameter |
| 3 | c1        | Breakdown path        | **NOT included** — breakdown resolves `{base_dir}/{c2}/{c3}/...`                                     | No path doubling; c1 appears once via base_dir                       |
| 4 | c2        | Runner step phase     | `step-phases.ts` maps c2 to stepKind: `initial`/`continuation` → work, `verification`, `closure`     | Runner reserves these c2 values for flow control                     |
| 5 | c2        | Breakdown directive   | Passed as the first positional argument to breakdown                                                 | Becomes the first directory segment after base_dir                   |
| 6 | c3        | Breakdown layer       | Passed as the second positional argument to breakdown                                                | Becomes the second directory segment after base_dir                  |
| 7 | base_dir  | Physical prompt root  | Defined in `{agentId}-{c1}-app.yml`, relative to `working_dir`                                       | All prompts for this {agentId, c1} live under this directory         |

### Path Resolution Formula

Breakdown resolves the physical file path by combining config values with
runtime arguments:

```
{working_dir} / {base_dir} / {c2} / {c3} / f_{edition}.md
     │               │         │      │
     │               │         │      └── from step definition (positional arg 2)
     │               │         └── from step definition (positional arg 1)
     │               └── from app.yml app_prompt.base_dir (includes c1 directory)
     └── from app.yml working_dir
```

c1 is **not** a separate parameter in this formula. It is already part of
`base_dir`. This is why changing `base_dir` from `"prompts/steps"` to
`"prompts"` breaks resolution — breakdown would look for
`prompts/initial/{c3}/...` instead of `prompts/steps/initial/{c3}/...`.

### Example: reviewer agent, initial.issue step

```
steps_registry.json:  agentId="reviewer", c1="steps"
config name:          "reviewer-steps"  (= {agentId}-{c1})
config file:          .agent/climpt/config/reviewer-steps-app.yml

app.yml contents:
  working_dir: ".agent/reviewer"
  app_prompt.base_dir: "prompts/steps"

Step definition:  c2="initial", c3="issue", edition="default"

Breakdown resolution:
  .agent/reviewer / prompts/steps / initial / issue / f_default.md
  └─ working_dir    └─ base_dir     └─ c2     └─ c3   └─ filename
```

The directory tree shows `prompts/steps/initial/issue/f_default.md` — c1
(`steps`) appears in the path, but only because `base_dir` contains it.
Breakdown never receives c1 as a separate argument.

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
└── reviewer/
    ├── steps_registry.json       # Reviewer step definitions
    └── prompts/steps/            # Reviewer prompts
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
- [Prompt System Design](../../agents/docs/design/07_prompt_system.md) — C3L
  directory structure, UV variables
- [Config System](../../agents/docs/builder/04_config_system.md) — Breakdown
  config naming, directiveType/layerType
