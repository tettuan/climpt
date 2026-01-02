[English](../en/05-architecture.md) | [日本語](../ja/05-architecture.md)

# 5. Climpt Overview

Explains Climpt's basic concepts, architecture, and command execution flow.

## Contents

1. [What is Climpt](#51-what-is-climpt)
2. [Architecture Overview](#52-architecture-overview)
3. [Command Execution Flow](#53-command-execution-flow)

---

## 5.1 What is Climpt

### Basic Concept

As the name "CLI + Prompt = Climpt" suggests, Climpt is a **tool for invoking prompts via CLI**.

```
┌─────────────────────────────────────────────────────────────┐
│                       Climpt's Role                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   Input                    Climpt                   Output  │
│  ┌──────┐              ┌──────────┐              ┌──────┐  │
│  │ Args │─────────────▶│ Template │─────────────▶│Prompt│  │
│  │ STDIN│              │ Replace  │              │      │  │
│  │ Files│              └──────────┘              └──────┘  │
│  └──────┘                   │                              │
│                             │                              │
│                    ┌────────▼────────┐                     │
│                    │ Prompt Files    │                     │
│                    │ (.md templates) │                     │
│                    └─────────────────┘                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### What It Does

| Function | Description |
|----------|-------------|
| Centralized prompt management | Organize and store pre-configured prompts |
| One-line invocation | Instantly retrieve with commands like `climpt-git create branch` |
| Dynamic value insertion | Replace variables with arguments or stdin |
| AI integration | AI selects and executes prompts via MCP server |

### C3L (Climpt 3-word Language)

Climpt commands consist of three elements:

| Element | Role | Examples |
|---------|------|----------|
| c1 (Domain) | Target area | `git`, `code`, `meta` |
| c2 (Action) | Action to execute | `create`, `analyze`, `review` |
| c3 (Target) | Target object | `branch`, `pull-request`, `instruction` |

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

### Component Structure

```
┌─────────────────────────────────────────────────────────────┐
│                    Climpt Architecture                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │                      User Input                       │ │
│  │  CLI Command / MCP Tool Call / Claude Code Plugin    │ │
│  └───────────────────────────────────────────────────────┘ │
│                            │                                │
│            ┌───────────────┼───────────────┐               │
│            │               │               │               │
│            ▼               ▼               ▼               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │    CLI      │  │    MCP      │  │   Plugin    │        │
│  │  Interface  │  │   Server    │  │  (Claude)   │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
│            │               │               │               │
│            └───────────────┼───────────────┘               │
│                            ▼                                │
│  ┌───────────────────────────────────────────────────────┐ │
│  │                    Core Engine                        │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │ │
│  │  │   Config    │  │   Prompt    │  │  Template   │   │ │
│  │  │   Loader    │  │   Loader    │  │   Engine    │   │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘   │ │
│  └───────────────────────────────────────────────────────┘ │
│                            │                                │
│                            ▼                                │
│  ┌───────────────────────────────────────────────────────┐ │
│  │                     File System                       │ │
│  │  .agent/climpt/config/    .agent/climpt/prompts/     │ │
│  │  .agent/climpt/registry.json                          │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Component Roles

| Component | Role |
|-----------|------|
| CLI Interface | Parse command-line args, invoke Core Engine |
| MCP Server | Handle tool calls from AI assistants |
| Plugin | Integration with Claude Code |
| Config Loader | Load config files (app.yml, user.yml) |
| Prompt Loader | Load prompt files (.md) |
| Template Engine | Replace template variables |

### Relationship with breakdown Package

Climpt uses the `@tettuan/breakdown` package internally:

```
┌─────────────────────────────────────────────────────────────┐
│                        Climpt                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                   CLI Interface                      │   │
│  │  climpt-git, climpt-meta, climpt-code ...           │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                  │
│                          ▼                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              @tettuan/breakdown                      │   │
│  │  - File loading                                     │   │
│  │  - Template variable replacement                    │   │
│  │  - Config file parsing                              │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

Features provided by breakdown package:
- YAML config file parsing
- Markdown prompt file loading
- Template variable (`{input_text}` etc.) replacement

---

## 5.3 Command Execution Flow

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

### Flowchart

```
┌──────────────────┐
│ Command Execute  │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Parse Arguments  │
│ c1, c2, c3,      │
│ options          │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐     ┌────────────────────────┐
│ Load Config      │────▶│ .agent/climpt/config/  │
│ Files            │     │ {c1}-app.yml           │
└────────┬─────────┘     └────────────────────────┘
         │
         ▼
┌──────────────────┐     ┌────────────────────────┐
│ Resolve & Load   │────▶│ prompts/{c1}/{c2}/{c3}/│
│ Prompt File      │     │ f_{edition}.md         │
└────────┬─────────┘     └────────────────────────┘
         │
         ▼
┌──────────────────┐
│ Load STDIN       │ (when stdin option set)
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Replace Template │
│ Variables        │
│ {input_text} →val│
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Output Result    │
│ (STDOUT)         │
└──────────────────┘
```

---

## Related Guides

- [06-config-files.md](./06-config-files.md) - Config Files
- [07-dependencies.md](./07-dependencies.md) - Dependencies (Registry, MCP)
- [08-prompt-structure.md](./08-prompt-structure.md) - Prompt Structure
