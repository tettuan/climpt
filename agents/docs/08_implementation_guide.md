# Implementation Guide

## Overview

This document provides a step-by-step guide for implementing agents in the
`climpt/agents` package. The implementation is organized into phases for
incremental development and testing.

## Prerequisites

- Deno 2.0+
- `jsr:@aidevtool/climpt` package
- Claude Agent SDK (`jsr:@anthropic-ai/claude-code`)

## Package Structure

```
agents/
+-- mod.ts                       # Public API exports
+-- CLAUDE.md                    # Agent development guidelines
+-- iterator/
|   +-- mod.ts                   # Iterator agent exports
|   +-- README.md
|   +-- CLAUDE.md
|   +-- config.json
|   +-- scripts/
|       +-- agent.ts             # Main agent runner
|       +-- cli.ts               # CLI argument parsing
|       +-- completion/          # Completion handlers
|       +-- github.ts            # GitHub integration
|       +-- logger.ts            # Agent-specific logging
+-- reviewer/
|   +-- mod.ts                   # Reviewer agent exports
|   +-- README.md
|   +-- scripts/
|   +-- prompts/
+-- common/
|   +-- mod.ts                   # Common exports
|   +-- types.ts                 # Shared types
|   +-- logger.ts                # Logger
|   +-- merge.ts                 # Deep merge utility
|   +-- step-registry.ts         # Step registry loader
|   +-- prompt-resolver.ts       # Prompt resolution
|   +-- worktree.ts              # Git worktree utilities
+-- schemas/
|   +-- agent.schema.json        # Agent definition schema
|   +-- steps_registry.schema.json # Steps registry schema
+-- docs/                        # Documentation
```

## Implementation Phases

### Phase 1: Core Types and Utilities

**Goal:** Establish foundational types and utility functions.

#### Step 1.1: Package Configuration

```json
// deno.json
{
  "imports": {
    "@anthropic-ai/claude-code": "jsr:@anthropic-ai/claude-code@^0.2.0",
    "@aidevtool/climpt": "jsr:@aidevtool/climpt@^1.10.1",
    "@std/cli": "jsr:@std/cli@^1.0.0",
    "@std/path": "jsr:@std/path@^1.0.0",
    "@std/fs": "jsr:@std/fs@^1.0.0",
    "@std/assert": "jsr:@std/assert@^1.0.0"
  },
  "tasks": {
    "agent:iterator": "deno run -A agents/iterator/mod.ts",
    "agent:reviewer": "deno run -A agents/reviewer/mod.ts",
    "test": "deno test -A",
    "lint": "deno lint",
    "fmt": "deno fmt",
    "check": "deno check mod.ts"
  }
}
```

#### Step 1.2: Shared Types

Create `agents/common/types.ts` with all type definitions from the design
documents.

#### Step 1.3: Utilities

Implement:

- `agents/common/merge.ts`
- `agents/common/logger.ts`
- `agents/common/step-registry.ts`

#### Step 1.4: Tests

```typescript
// agents/common/merge_test.ts
import { assertEquals } from "@std/assert";
import { deepMerge } from "./merge.ts";

Deno.test("deepMerge - merges objects", () => {
  const base = { a: 1, b: { c: 2 } };
  const override = { b: { d: 3 } };
  const result = deepMerge(base, override);
  assertEquals(result, { a: 1, b: { c: 2, d: 3 } });
});
```

### Phase 2: Agent Loader

**Goal:** Load and validate agent definitions.

#### Step 2.1: Loader Implementation

Create `agents/common/loader.ts`:

- `loadAgentDefinition()` function
- `validateAgentDefinition()` function

#### Step 2.2: CLI Parser

Create `agents/common/cli.ts`:

- Dynamic argument parsing based on agent parameters
- Validation of required parameters

#### Step 2.3: Tests

```typescript
// agents/common/loader_test.ts
import { assertEquals, assertThrows } from "@std/assert";
import { loadAgentDefinition, validateAgentDefinition } from "./loader.ts";

Deno.test("loadAgentDefinition - loads valid definition", async () => {
  const def = await loadAgentDefinition("test-agent", "./tests/fixtures");
  assertEquals(def.name, "test-agent");
});
```

### Phase 3: Completion Handlers

**Goal:** Implement completion handler system.

#### Step 3.1: Interface and Types

Create `agents/common/completion/types.ts` with `CompletionHandler` interface.

#### Step 3.2: Built-in Handlers

Implement in order:

1. `agents/iterator/scripts/completion/iterate.ts` (simplest)
2. `agents/common/completion/manual.ts`
3. `agents/iterator/scripts/completion/issue.ts`
4. `agents/iterator/scripts/completion/project.ts`

#### Step 3.3: Factory

Create `agents/common/completion/factory.ts`:

- `createCompletionHandler()` function
- Custom handler loading

#### Step 3.4: Tests

```typescript
// agents/iterator/scripts/completion/iterate_test.ts
Deno.test("IterateCompletionHandler - completes after max", async () => {
  const handler = new IterateCompletionHandler({
    maxIterations: 3,
    promptResolver: mockResolver,
  });

  await handler.buildContinuationPrompt(3, []);
  assertEquals(await handler.isComplete(mockSummary), true);
});
```

### Phase 4: Prompt System

**Goal:** Integrate with Climpt for prompt resolution.

#### Step 4.1: PromptResolver

Create `agents/common/prompt-resolver.ts`:

- Step registry loading
- C3L path building
- Climpt CLI integration
- Fallback rendering

#### Step 4.2: Fallback Provider

Create `agents/common/fallback-prompts.ts` for when Climpt is unavailable.

#### Step 4.3: Tests

```typescript
// agents/common/prompt-resolver_test.ts
Deno.test("PromptResolver - resolves step", async () => {
  const resolver = await PromptResolver.create({
    agentName: "test",
    agentDir: "./tests/fixtures/agent",
    registryPath: "steps_registry.json",
  });

  const prompt = await resolver.resolve("initial_manual", {
    "uv-topic": "Test",
  });

  assertStringIncludes(prompt, "Test");
});
```

### Phase 5: Action System

**Goal:** Detect and execute structured actions.

#### Step 5.1: Action Detector

Create `agents/common/actions/detector.ts`:

- Parse markdown code blocks
- Extract action JSON
- Validate action types

#### Step 5.2: Action Executor

Create `agents/common/actions/executor.ts`:

- Handler registration
- Action execution pipeline

#### Step 5.3: Built-in Handlers

Implement:

- `agents/common/actions/handlers/log.ts`
- `agents/common/actions/handlers/github_issue.ts`
- `agents/common/actions/handlers/file.ts`

#### Step 5.4: Tests

````typescript
// agents/common/actions/detector_test.ts
Deno.test("ActionDetector - detects actions", () => {
  const detector = new ActionDetector({
    enabled: true,
    types: ["decision"],
    outputFormat: "test-action",
  });

  const content =
    '```test-action\n{"type": "decision", "content": "Test"}\n```';
  const actions = detector.detect(content);

  assertEquals(actions.length, 1);
  assertEquals(actions[0].type, "decision");
});
````

### Phase 6: Agent Runner

**Goal:** Implement the main execution engine.

#### Step 6.1: AgentRunner Class

Create `agents/common/runner.ts`:

- Initialization
- Agent loop
- Claude SDK integration
- Message processing

#### Step 6.2: CLI Entry Point

Create individual agent entry points:

- `agents/iterator/mod.ts`
- `agents/reviewer/mod.ts`

#### Step 6.3: Agent Initialization

Create `agents/init.ts`:

- Template generation
- Directory creation

### Phase 7: Integration and Testing

**Goal:** End-to-end testing and refinement.

#### Step 7.1: Integration Tests

```typescript
// tests/integration/agent_run_test.ts
Deno.test("Agent - runs to completion", async () => {
  const definition = await loadAgentDefinition(
    "test-agent",
    "./tests/fixtures",
  );
  const runner = new AgentRunner(definition);

  const result = await runner.run({
    args: { topic: "Test" },
    cwd: "./tests/fixtures",
  });

  assertEquals(result.success, true);
});
```

#### Step 7.2: Example Agents

The following agents are already implemented:

- `iterator` - Issue/Project completion
- `reviewer` - Code review agent

### Phase 8: Documentation and Release

**Goal:** Prepare for release.

#### Step 8.1: Public API

Create `agents/mod.ts` with all public exports.

#### Step 8.2: JSON Schema

Schema files are available at:

- `agents/schemas/agent.schema.json`
- `agents/schemas/steps_registry.schema.json`

#### Step 8.3: Release

```bash
# Lint and format
deno task lint
deno task fmt

# Run all tests
deno task test

# Check types
deno task check

# Publish to JSR
deno publish
```

## File Implementation Order

1. `agents/common/types.ts`
2. `agents/common/merge.ts`
3. `agents/common/logger.ts`
4. `agents/common/step-registry.ts`
5. `agents/common/loader.ts`
6. `agents/common/cli.ts`
7. `agents/common/completion/types.ts`
8. `agents/iterator/scripts/completion/iterate.ts`
9. `agents/common/completion/manual.ts`
10. `agents/iterator/scripts/completion/issue.ts`
11. `agents/iterator/scripts/completion/project.ts`
12. `agents/common/completion/factory.ts`
13. `agents/common/prompt-resolver.ts`
14. `agents/common/fallback-prompts.ts`
15. `agents/common/actions/types.ts`
16. `agents/common/actions/detector.ts`
17. `agents/common/actions/handlers/log.ts`
18. `agents/common/actions/handlers/github_issue.ts`
19. `agents/common/actions/handlers/file.ts`
20. `agents/common/actions/executor.ts`
21. `agents/common/runner.ts`
22. `agents/init.ts`
23. `agents/iterator/mod.ts`
24. `agents/reviewer/mod.ts`
25. `agents/mod.ts`

## Testing Strategy

### Unit Tests

Test individual components in isolation:

- Deep merge utility
- Agent definition validation
- Completion handlers
- Action detection

### Integration Tests

Test component interactions:

- Loader + Validator
- PromptResolver + Climpt
- Runner + CompletionHandler

### End-to-End Tests

Test complete agent execution:

- Issue completion flow
- Iterate completion flow
- Action detection and execution

## Climpt Integration

### Registry Integration (Optional)

Register agents in Climpt registry:

```json
// .agent/climpt/registry.json
{
  "tools": {
    "availableConfigs": ["meta", "agents"],
    "commands": [
      {
        "c1": "agents",
        "c2": "run",
        "c3": "iterator",
        "description": "Run iterator agent",
        "usage": "climpt-agents run iterator"
      }
    ]
  }
}
```

### Prompt Configuration

```yaml
# .agent/climpt/config/agents-app.yml
working_dir: ".agent/climpt"
app_prompt:
  base_dir: "prompts/agents"
```

## Deployment

### JSR Publication

This package is published as part of `jsr:@aidevtool/climpt`.

```bash
# Run tests
deno task test

# Lint and format
deno task lint
deno task fmt

# Publish
deno publish
```

### Using Agents

```bash
# Run iterator agent
deno run -A jsr:@aidevtool/climpt/agents/iterator --issue 123

# Run reviewer agent
deno run -A jsr:@aidevtool/climpt/agents/reviewer --target src/
```

## Troubleshooting

### Common Issues

1. **Agent definition not found**
   - Check `.agent/{name}/agent.json` exists
   - Verify path is correct

2. **Completion handler error**
   - Verify `completionType` matches config
   - Check required config fields

3. **Prompt resolution failed**
   - Verify `steps_registry.json` is valid
   - Check prompt files exist at C3L paths

4. **Action not detected**
   - Verify `outputFormat` matches code block
   - Check action type is in `types` array

## Next Steps

After basic implementation:

1. Add more built-in action handlers
2. Implement additional completion handlers
3. Add worktree support
4. Create agent templates
5. Add monitoring and metrics
