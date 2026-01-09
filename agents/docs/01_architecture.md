# Climpt Agents Architecture

## Overview

`climpt-agents` is a Deno TypeScript agent framework integrated into the Climpt
repository. It provides generic agent execution capabilities using the Claude
Agent SDK.

## Design Principles

1. **Separation of Concerns**: Agent framework is separated from Climpt core
2. **Dependency Direction**: agents -> climpt (not reverse)
3. **Extensibility**: Easy to add new agents and completion handlers
4. **Optional Inclusion**: Users can choose whether to use the agent framework
5. **Clean Abstraction**: High-level abstractions that don't leak implementation
   details

## Package Architecture

```
+-------------------------------------------------------------------------+
|                         User Project                                     |
|                                                                          |
|  .agent/{agent-name}/                                                   |
|  +-- agent.json           # Agent definition                           |
|  +-- config.json          # Runtime configuration                       |
|  +-- steps_registry.json  # Step definitions                           |
|  +-- prompts/             # Agent prompts (C3L structure)              |
|                                                                          |
+----------------------------------+--------------------------------------+
                                   |
                                   v
+-------------------------------------------------------------------------+
|              climpt/agents (this package)                                |
|                                                                          |
|  agents/                                                                |
|  +-- mod.ts                 # Public API                                |
|  +-- iterator/              # Iterator agent                            |
|  +-- reviewer/              # Reviewer agent                            |
|  +-- common/                # Shared utilities                          |
|  |   +-- mod.ts                                                         |
|  |   +-- types.ts           # Shared types                              |
|  |   +-- logger.ts          # Logging                                   |
|  |   +-- step-registry.ts   # Step registry loader                      |
|  |   +-- prompt-resolver.ts # Prompt resolution                         |
|  |   +-- merge.ts           # Deep merge utility                        |
|  +-- schemas/               # JSON Schema files                         |
|  +-- docs/                  # Documentation                             |
|                                                                          |
+----------------------------------+--------------------------------------+
                                   |
                                   v
+-------------------------------------------------------------------------+
|                      jsr:@aidevtool/climpt                               |
|                                                                          |
|  - Prompt template rendering                                            |
|  - C3L (Category/Classification/Chapter) path resolution               |
|  - UV variable substitution                                             |
|  - Registry management                                                  |
|                                                                          |
+----------------------------------+--------------------------------------+
                                   |
                                   v
+-------------------------------------------------------------------------+
|                   npm:@anthropic-ai/claude-agent-sdk                     |
|                                                                          |
|  - Claude Agent SDK                                                     |
|  - query() API for agent execution                                      |
|                                                                          |
+-------------------------------------------------------------------------+
```

## Layer Responsibilities

| Layer           | Package       | Responsibility                                     |
| --------------- | ------------- | -------------------------------------------------- |
| User Project    | -             | Agent definitions, prompts, configurations         |
| Agent Framework | climpt/agents | Generic runner, completion handlers, action system |
| Prompt Engine   | climpt        | Template rendering, C3L, UV variables              |
| Agent SDK       | claude-code   | LLM interaction, tool execution                    |

## Directory Structure

### Package Source (`agents/`)

```
agents/
+-- mod.ts                    # Public API exports
+-- CLAUDE.md                 # Agent development guidelines
+-- iterator/
|   +-- mod.ts                # Iterator agent exports
|   +-- README.md
|   +-- CLAUDE.md
|   +-- config.json
|   +-- scripts/
|       +-- agent.ts          # Main agent runner
|       +-- cli.ts            # CLI argument parsing
|       +-- completion/       # Completion handlers
|       +-- github.ts         # GitHub integration
|       +-- logger.ts         # Agent-specific logging
+-- reviewer/
|   +-- mod.ts                # Reviewer agent exports
|   +-- README.md
|   +-- CLAUDE.md
|   +-- config.json
|   +-- scripts/
|   +-- prompts/
+-- common/
|   +-- mod.ts                # Common exports
|   +-- types.ts              # Shared types
|   +-- logger.ts             # Logger
|   +-- merge.ts              # Deep merge utility
|   +-- step-registry.ts      # Step registry loader
|   +-- prompt-resolver.ts    # Prompt resolution
|   +-- worktree.ts           # Git worktree utilities
|   +-- coordination.ts       # Agent coordination
+-- schemas/
|   +-- agent.schema.json     # Agent definition schema
|   +-- steps_registry.schema.json # Steps registry schema
+-- docs/                     # Documentation
```

### User Project Structure (`.agent/`)

```
.agent/
+-- {agent-name}/                    # Per-agent directory
|   +-- agent.json                   # Agent definition (required)
|   +-- config.json                  # Runtime config (optional)
|   +-- steps_registry.json          # Step definitions (required)
|   +-- prompts/                     # Agent prompts
|       +-- system.md                # System prompt
|       +-- steps/                   # C3L: c1
|           +-- initial/             # C3L: c2
|           |   +-- issue/           # C3L: c3
|           |   |   +-- f_default.md
|           |   +-- iterate/
|           |   |   +-- f_default.md
|           |   +-- manual/
|           |       +-- f_default.md
|           +-- continuation/        # C3L: c2
|               +-- issue/
|               |   +-- f_default.md
|               +-- iterate/
|               |   +-- f_default.md
|               +-- manual/
|                   +-- f_default.md
|
+-- climpt/                          # Climpt configuration (from climpt init)
    +-- registry.json
    +-- config/
        +-- registry_config.json
```

## Execution Flow

```
+-------------------------------------------------------------------------+
| 1. CLI Invocation                                                        |
|    deno run -A jsr:@aidevtool/climpt/agents/iterator --issue 123         |
+--------------------------------------------+----------------------------+
                                             |
                                             v
+-------------------------------------------------------------------------+
| 2. Load Agent Definition                                                 |
|    - Read .agent/{name}/agent.json                                      |
|    - Validate schema                                                     |
|    - Merge with config.json                                             |
+--------------------------------------------+----------------------------+
                                             |
                                             v
+-------------------------------------------------------------------------+
| 3. Initialize Components                                                 |
|    - Create CompletionHandler based on completionType                   |
|    - Initialize PromptResolver with Climpt                              |
|    - Setup ActionDetector/Executor if enabled                           |
|    - Initialize Logger                                                  |
+--------------------------------------------+----------------------------+
                                             |
                                             v
+-------------------------------------------------------------------------+
| 4. Agent Loop                                                            |
|    while (!completionHandler.isComplete()) {                            |
|      - Build prompt (initial or continuation)                           |
|      - Call Claude SDK query()                                          |
|      - Process messages                                                 |
|      - Detect and execute actions                                       |
|      - Check completion condition                                       |
|    }                                                                     |
+--------------------------------------------+----------------------------+
                                             |
                                             v
+-------------------------------------------------------------------------+
| 5. Post-processing                                                       |
|    - Generate report                                                    |
|    - Save logs                                                          |
|    - Return result                                                      |
+-------------------------------------------------------------------------+
```

## Dependencies

### Required Dependencies

```json
{
  "imports": {
    "@anthropic-ai/claude-agent-sdk": "npm:@anthropic-ai/claude-agent-sdk@^0.2.0",
    "@aidevtool/climpt": "jsr:@aidevtool/climpt@^1.10.1",
    "@std/cli": "jsr:@std/cli@^1.0.0",
    "@std/path": "jsr:@std/path@^1.0.0",
    "@std/fs": "jsr:@std/fs@^1.0.0"
  }
}
```

### Climpt Integration Points

1. **Prompt Resolution**: Use Climpt's breakdown engine for template rendering
2. **C3L Path Resolution**: Leverage existing C3L path resolution
3. **UV Variable Substitution**: Use Climpt's UV variable system
4. **Registry Integration**: Optionally register agents in Climpt registry

## Public API

```typescript
// agents/mod.ts - Public API

// Iterator Agent
export { runIterator } from "./iterator/mod.ts";

// Reviewer Agent
export { runReviewer } from "./reviewer/mod.ts";

// Common utilities
export * from "./common/mod.ts";
```

## Usage Examples

### Running an Agent

```bash
# Using CLI
deno run -A jsr:@aidevtool/climpt/agents/iterator --issue 123

# Or with task in deno.json
deno task agent:iterator --issue 123
```

### Programmatic Usage

```typescript
import { runIterator } from "jsr:@aidevtool/climpt/agents";

const result = await runIterator({
  issue: 123,
  cwd: Deno.cwd(),
});

console.log(`Completed with ${result.totalIterations} iterations`);
```

## Design Decisions

### Why Integrated into Climpt?

1. **Single Package**: Easier distribution and dependency management
2. **Shared Infrastructure**: Leverage existing prompt resolution and registry
3. **Consistent Versioning**: Agent framework versions match Climpt versions

### Why Depend on Climpt?

1. **Reuse**: Leverage existing prompt resolution infrastructure
2. **Consistency**: Same C3L system and UV variables
3. **Integration**: Seamless integration with existing Climpt workflows

### Why Use Claude SDK?

1. **Official Support**: Anthropic's official agent SDK
2. **Tool Integration**: Built-in tool handling
3. **Session Management**: Automatic session and context management
