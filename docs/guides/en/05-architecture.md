[English](../en/05-architecture.md) | [日本語](../ja/05-architecture.md)

# 5. Climpt Overview

Explains Climpt's basic concepts, architecture, and command execution flow.

## 5.1 What is Climpt

### Basic Concept

As the name "CLI + Prompt = Climpt" suggests, Climpt is a **tool for invoking
prompts via CLI**. It takes input (args, STDIN, files), applies template
replacement using prompt files (.md templates), and outputs the final prompt.

### What It Does

| Function                      | Description                                                      |
| ----------------------------- | ---------------------------------------------------------------- |
| Centralized prompt management | Organize and store pre-configured prompts                        |
| One-line invocation           | Instantly retrieve with commands like `climpt-git create branch` |
| Dynamic value insertion       | Replace variables with arguments or stdin                        |
| AI integration                | AI selects and executes prompts via MCP server                   |

### C3L (Climpt 3-word Language)

Climpt commands consist of three elements:

| Element     | Role              | Examples                                |
| ----------- | ----------------- | --------------------------------------- |
| c1 (Domain) | Target area       | `git`, `code`, `meta`                   |
| c2 (Action) | Action to execute | `create`, `analyze`, `review`           |
| c3 (Target) | Target object     | `branch`, `pull-request`, `instruction` |

Command format:

```
climpt-<c1> <c2> <c3> [options]
```

Examples:

```bash
climpt-git decide-branch working-branch
climpt-meta create instruction
climpt-code review pull-request
```

---

## 5.2 Architecture Overview

### Component Roles

| Component       | Role                                        |
| --------------- | ------------------------------------------- |
| CLI Interface   | Parse command-line args, invoke Core Engine |
| MCP Server      | Handle tool calls from AI assistants        |
| Plugin          | Integration with Claude Code                |
| Config Loader   | Load config files (app.yml, user.yml)       |
| Prompt Loader   | Load prompt files (.md)                     |
| Template Engine | Replace template variables                  |

User input (CLI Command / MCP Tool Call / Claude Code Plugin) flows through one
of three interfaces (CLI, MCP, Plugin), which all converge on the Core Engine
(Config Loader, Prompt Loader, Template Engine), backed by the File System
(`.agent/climpt/config/`, `.agent/climpt/prompts/`,
`.agent/climpt/registry.json`).

### Relationship with breakdown Package

Climpt uses the `@tettuan/breakdown` package internally as its core engine:

- YAML config file parsing
- Markdown prompt file loading
- Template variable (`{input_text}` etc.) replacement

---

## 5.3 5-Layer Structure

Climpt has evolved incrementally and now consists of five layers.

### Layer Overview

- **Agent Layer (Autonomous)**
  - **Top Layer**: Iterator/Reviewer Agent -- Claude Agent SDK for GitHub
    Issue/Project
  - **Middle Layer**: delegate-climpt-agent Skill -- Claude Code Plugin, command
    search and options
  - **Execution Layer**: climpt-agent.ts (Sub-Agent) -- Autonomous execution via
    Claude Agent SDK
- **Foundation Layer**
  - **Tool Layer**: CLI / MCP -- Interface for prompt retrieval
  - **Config Layer**: registry.json / prompts/ -- Template transformation via
    @tettuan/breakdown

### Layer Roles

| Layer           | Role                                     | Context         | Implementation                                                              |
| --------------- | ---------------------------------------- | --------------- | --------------------------------------------------------------------------- |
| Top Layer       | GitHub integration, iteration control    | SDK Session #1  | `agents/scripts/run-agent.ts`                                               |
| Middle Layer    | Parameter conversion, command resolution | Plugin Context  | `plugins/climpt-agent/skills/delegate-climpt-agent/SKILL.md`                |
| Execution Layer | Prompt retrieval, autonomous execution   | SDK Session #2  | `plugins/climpt-agent/skills/delegate-climpt-agent/scripts/climpt-agent.ts` |
| Tool Layer      | CLI/MCP invocation                       | CLI/MCP Process | `cli.ts`, `mcp.ts`                                                          |
| Config Layer    | Prompt templates                         | File System     | `.agent/climpt/`                                                            |

### Three-Layer Chain (Within Agent Layer)

The Agent layer chains three layers together, achieving flexible autonomous
operation through **context separation**.

**Key Points**:

- Top and Execution layers run in **separate SDK sessions**
- Middle layer acts as a **bridge**, handling parameter conversion and search
- Each layer's context is isolated, making responsibilities clear

### Entry Points

| Purpose        | Entry Point                             |
| -------------- | --------------------------------------- |
| CLI execution  | `jsr:@aidevtool/climpt/cli`             |
| MCP server     | `jsr:@aidevtool/climpt/mcp`             |
| Iterator Agent | `jsr:@aidevtool/climpt/agents/iterator` |
| Reviewer Agent | `jsr:@aidevtool/climpt/agents/reviewer` |

---

## 5.4 Command Execution Flow

### Example Execution

```bash
echo "Bug fix implementation" | climpt-git decide-branch working-branch -o=./output/
```

### Processing Flow (5 Steps)

```
Step 1: Command Parsing
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  climpt-git decide-branch working-branch -o=./output/
     │         │              │              │
     │         │              │              └─ destination: ./output/
     │         │              └─ c3 (target): working-branch
     │         └─ c2 (action): decide-branch
     └─ c1 (domain): git (--config=git)

Step 2: Config File Loading
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  .agent/climpt/config/git-app.yml
    └─ working_dir: ".agent/climpt"
    └─ app_prompt.base_dir: "prompts/git"

Step 3: Prompt File Resolution
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Path construction:
    base_dir + c2 + c3 + filename
    = prompts/git/decide-branch/working-branch/f_default.md

  Selection by edition/adaptation:
    --edition=bug --adaptation=detailed
    → Look for f_bug_detailed.md
    → If not found, f_bug.md
    → If not found, f_default.md

Step 4: Template Variable Replacement
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  In prompt:
    {input_text}        → "Bug fix implementation" (STDIN)
    {destination_path}  → "./output/"

Step 5: Output Result
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Replaced prompt to standard output
```
