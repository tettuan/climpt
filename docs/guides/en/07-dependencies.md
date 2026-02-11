[English](../en/07-dependencies.md) | [日本語](../ja/07-dependencies.md)

# 7. Dependencies

Explains Climpt's registry, MCP server, and external package dependencies.

## 7.1 Package Dependencies

### Main Packages

| Package                            | Role                                | JSR URL                                |
| ---------------------------------- | ----------------------------------- | -------------------------------------- |
| `@aidevtool/climpt`                | Main package                        | `jsr:@aidevtool/climpt`                |
| `@tettuan/breakdown`               | Core features (template processing) | `jsr:@tettuan/breakdown`               |
| `@aidevtool/frontmatter-to-schema` | Registry generation                 | `jsr:@aidevtool/frontmatter-to-schema` |

`@aidevtool/climpt` provides entry points: `/cli` (CLI execution), `/mcp` (MCP
server), `/reg` (registry generation), `/agents/iterator` (Iterate Agent). It
depends on `@tettuan/breakdown` for YAML config parsing, prompt file loading,
and template variable replacement, and on `@aidevtool/frontmatter-to-schema` for
generating registries from frontmatter.

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

Registry generation scans prompt files, extracts frontmatter metadata,
transforms it according to a schema, and outputs `registry.json`.

**Flow**: Scan `.agent/climpt/prompts/**/*.md` -> Extract frontmatter (c1, c2,
c3, description, options) -> Transform via `registry.schema.json` -> Output
`.agent/climpt/registry.json`

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

### Climpt MCP Server

The MCP server exposes Climpt commands to AI assistants via MCP protocol. It
loads commands from `registry_config.json` through its Registry Manager and
provides three tools:

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

The climpt-agent plugin integrates Climpt into Claude Code, connecting to Climpt
core features (command execution, prompt generation, registry management)
through three paths: Skill calls, MCP server, and Iterate Agent.

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

User/AI input flows through CLI/MCP/Plugin -> `registry.json` identifies the
command -> `app.yml` resolves the prompt path -> prompt template
(`f_default.md`) undergoes template replacement -> final prompt is output.
