[English](../en/07-dependencies.md) | [日本語](../ja/07-dependencies.md)

# 7. Dependencies

Explains Climpt's registry, MCP server, and external package dependencies.

## Contents

1. [Package Dependencies](#71-package-dependencies)
2. [Registry Mechanism](#72-registry-mechanism)
3. [Registry Generation](#73-registry-generation)
4. [MCP Server Operation](#74-mcp-server-operation)
5. [Claude Code Plugin Integration](#75-claude-code-plugin-integration)

---

## 7.1 Package Dependencies

### Dependency Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                   Climpt Package Structure                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │          jsr:@aidevtool/climpt                        │ │
│  │                                                       │ │
│  │  Entry points:                                        │ │
│  │  - /cli      → CLI execution                         │ │
│  │  - /mcp      → MCP server                            │ │
│  │  - /reg      → Registry generation                   │ │
│  │  - /agents/iterator → Iterate Agent                  │ │
│  └───────────────────────────────────────────────────────┘ │
│                            │                                │
│                            ▼                                │
│  ┌───────────────────────────────────────────────────────┐ │
│  │          jsr:@tettuan/breakdown                       │ │
│  │                                                       │ │
│  │  Features:                                            │ │
│  │  - YAML config file parsing                          │ │
│  │  - Prompt file loading                               │ │
│  │  - Template variable replacement                     │ │
│  └───────────────────────────────────────────────────────┘ │
│                            │                                │
│                            ▼                                │
│  ┌───────────────────────────────────────────────────────┐ │
│  │       jsr:@aidevtool/frontmatter-to-schema           │ │
│  │                                                       │ │
│  │  Features:                                            │ │
│  │  - Generate registry from frontmatter                │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Main Packages

| Package                            | Role                                | JSR URL                                |
| ---------------------------------- | ----------------------------------- | -------------------------------------- |
| `@aidevtool/climpt`                | Main package                        | `jsr:@aidevtool/climpt`                |
| `@tettuan/breakdown`               | Core features (template processing) | `jsr:@tettuan/breakdown`               |
| `@aidevtool/frontmatter-to-schema` | Registry generation                 | `jsr:@aidevtool/frontmatter-to-schema` |

---

## 7.2 Registry Mechanism

### Role of registry.json

The registry is a file that holds all available commands and their metadata.

```json
{
  "version": "1.0.0",
  "description": "Climpt command registry",
  "tools": {
    "availableConfigs": ["git", "meta", "code"],
    "commands": [
      {
        "c1": "git",
        "c2": "decide-branch",
        "c3": "working-branch",
        "description": "Decide branch strategy based on task",
        "usage": "climpt-git decide-branch working-branch",
        "options": {
          "edition": ["default"],
          "adaptation": ["default"],
          "file": false,
          "stdin": true,
          "destination": false
        }
      }
    ]
  }
}
```

### Registry Uses

| Use            | Description                       |
| -------------- | --------------------------------- |
| MCP Server     | Notify AI of available tools      |
| CLI Help       | Display option info with `--help` |
| Validation     | Detect invalid commands           |
| Command Search | Keyword-based command search      |

### Registry Schema

```typescript
interface Registry {
  version: string; // Registry version
  description: string; // Description
  tools: {
    availableConfigs: string[]; // Available domains
    commands: Command[]; // Command definitions
  };
}

interface Command {
  c1: string; // Domain
  c2: string; // Action
  c3: string; // Target
  description: string; // Command description
  usage: string; // Usage example
  options: {
    edition: string[]; // Edition list
    adaptation: string[]; // Processing mode list
    file: boolean; // File input support
    stdin: boolean; // STDIN support
    destination: boolean; // Output destination support
  };
  uv?: Array<{ [key: string]: string }>; // User variables
}
```

---

## 7.3 Registry Generation

### Generation Flow

```
┌─────────────────────────────────────────────────────────────┐
│                   Registry Generation Flow                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Step 1: Scan Prompt Files                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ .agent/climpt/prompts/**/*.md                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                │
│                            ▼                                │
│  Step 2: Extract Frontmatter                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ ---                                                 │   │
│  │ c1: git                                             │   │
│  │ c2: decide-branch                                   │   │
│  │ c3: working-branch                                  │   │
│  │ description: ...                                    │   │
│  │ options: ...                                        │   │
│  │ ---                                                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                │
│                            ▼                                │
│  Step 3: Transform According to Schema                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Use registry.schema.json                            │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                │
│                            ▼                                │
│  Step 4: Output registry.json                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ .agent/climpt/registry.json                         │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Generation Commands

```bash
# In Claude Code
/reg

# Deno Task
deno task generate-registry

# Direct JSR execution
deno run --allow-read --allow-write --allow-env jsr:@aidevtool/climpt/reg
```

### Options

```bash
deno run jsr:@aidevtool/climpt/reg \
  --base=.agent/climpt \
  --input="prompts/**/*.md" \
  --output=registry.json \
  --template=registry.schema.json
```

| Option       | Description        | Default           |
| ------------ | ------------------ | ----------------- |
| `--base`     | Base directory     | `.agent/climpt`   |
| `--input`    | Input glob pattern | `prompts/**/*.md` |
| `--output`   | Output file        | `registry.json`   |
| `--template` | Schema file        | (built-in)        |

---

## 7.4 MCP Server Operation

### What is MCP

MCP (Model Context Protocol) is a standard protocol for AI assistants to
interact with external tools.

### Climpt MCP Server Structure

```
┌─────────────────────────────────────────────────────────────┐
│                    MCP Server Operation                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │                  Claude / AI Assistant               │ │
│  └───────────────────────────────────────────────────────┘ │
│                            │                                │
│                     MCP Protocol                            │
│                            │                                │
│                            ▼                                │
│  ┌───────────────────────────────────────────────────────┐ │
│  │                  Climpt MCP Server                    │ │
│  │  ┌─────────────────────────────────────────────────┐ │ │
│  │  │                    Tools                        │ │ │
│  │  │  - search: Command search                       │ │ │
│  │  │  - describe: Get command details                │ │ │
│  │  │  - execute: Execute command                     │ │ │
│  │  └─────────────────────────────────────────────────┘ │ │
│  │                         │                            │ │
│  │                         ▼                            │ │
│  │  ┌─────────────────────────────────────────────────┐ │ │
│  │  │              Registry Manager                   │ │ │
│  │  │  Loads from registry_config.json               │ │ │
│  │  └─────────────────────────────────────────────────┘ │ │
│  └───────────────────────────────────────────────────────┘ │
│                            │                                │
│                            ▼                                │
│  ┌───────────────────────────────────────────────────────┐ │
│  │              .agent/climpt/registry.json              │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### MCP Tools List

| Tool       | Function                   | Parameters                             |
| ---------- | -------------------------- | -------------------------------------- |
| `search`   | Search commands by keyword | `query`, `agent?`                      |
| `describe` | Get command details        | `c1`, `c2`, `c3`, `agent?`             |
| `execute`  | Execute command            | `c1`, `c2`, `c3`, `stdin?`, `options?` |

### Usage Examples

```javascript
// Command search
search({ query: "branch" });

// Get command details
describe({
  c1: "git",
  c2: "decide-branch",
  c3: "working-branch",
});

// Execute command
execute({
  c1: "git",
  c2: "decide-branch",
  c3: "working-branch",
  stdin: "Bug fix implementation",
});

// Search in different agent
search({ query: "analyze", agent: "inspector" });
```

### MCP Configuration

```json
// .mcp.json or ~/.claude.json
{
  "mcpServers": {
    "climpt": {
      "command": "deno",
      "args": [
        "run",
        "--allow-read",
        "--allow-write",
        "--allow-net",
        "--allow-env",
        "--allow-run",
        "jsr:@aidevtool/climpt/mcp"
      ]
    }
  }
}
```

---

## 7.5 Claude Code Plugin Integration

### Integration Structure

```
┌─────────────────────────────────────────────────────────────┐
│                 Claude Code Plugin Integration               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │                    Claude Code                        │ │
│  │  ┌─────────────────────────────────────────────────┐ │ │
│  │  │            climpt-agent plugin                  │ │ │
│  │  │  - delegate-climpt-agent Skill                  │ │ │
│  │  │  - /climpt command                              │ │ │
│  │  └─────────────────────────────────────────────────┘ │ │
│  └───────────────────────────────────────────────────────┘ │
│                            │                                │
│            ┌───────────────┼───────────────┐               │
│            │               │               │               │
│            ▼               ▼               ▼               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │   Skill     │  │    MCP      │  │  Iterate    │        │
│  │   Call      │  │   Server    │  │   Agent     │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
│            │               │               │               │
│            └───────────────┼───────────────┘               │
│                            ▼                                │
│  ┌───────────────────────────────────────────────────────┐ │
│  │              Climpt Core Features                     │ │
│  │  - Command execution                                  │ │
│  │  - Prompt generation                                  │ │
│  │  - Registry management                                │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Plugin Features

| Feature                       | Description                                                   |
| ----------------------------- | ------------------------------------------------------------- |
| `delegate-climpt-agent` Skill | Delegate tasks to Climpt agent                                |
| Natural language commands     | Search and execute appropriate commands from natural language |
| Git workflows                 | Commit grouping, branch management                            |

### Skill Invocation Example

```
Use Climpt to commit the current changes.
→ delegate-climpt-agent Skill is invoked
→ group-commit unstaged-changes is executed
```

---

## Overall Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                        Data Flow                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  [User/AI]                                                  │
│       │                                                     │
│       ▼                                                     │
│  ┌─────────────────┐                                       │
│  │ CLI / MCP /     │                                       │
│  │ Plugin          │                                       │
│  └────────┬────────┘                                       │
│           │                                                 │
│           ▼                                                 │
│  ┌─────────────────┐     ┌─────────────────┐              │
│  │ registry.json   │────▶│ Identify Command│              │
│  └─────────────────┘     └────────┬────────┘              │
│                                   │                         │
│                                   ▼                         │
│  ┌─────────────────┐     ┌─────────────────┐              │
│  │ app.yml         │────▶│ Resolve Path    │              │
│  └─────────────────┘     └────────┬────────┘              │
│                                   │                         │
│                                   ▼                         │
│  ┌─────────────────┐     ┌─────────────────┐              │
│  │ f_default.md    │────▶│ Template        │              │
│  │ (prompt)        │     │ Replacement     │              │
│  └─────────────────┘     └────────┬────────┘              │
│                                   │                         │
│                                   ▼                         │
│                          ┌─────────────────┐              │
│                          │ Prompt Output   │              │
│                          └─────────────────┘              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Related Guides

- [05-architecture.md](./05-architecture.md) - Architecture Overview
- [06-config-files.md](./06-config-files.md) - Config Files
- [08-prompt-structure.md](./08-prompt-structure.md) - Prompt Structure
