[English](../en/00-overview.md) | [日本語](../ja/00-overview.md)

# Iterate Agent Introduction Guide

A guide for building an autonomous development environment that automatically
processes GitHub Issues and Projects using Climpt and Iterate Agent.

## Target Audience

- Those interested in AI-assisted development automation
- Those who want to automate GitHub Issue/Project-based development workflows
- Those considering development efficiency improvements using Claude Code

## Guide Structure

This guide is divided into the following files for step-by-step environment
setup:

| Chapter | File                                                       | Content                           |
| ------- | ---------------------------------------------------------- | --------------------------------- |
| 0.1     | [00-1-concepts.md](./00-1-concepts.md)                     | **Agent concepts (what/why)**     |
| 1       | [01-prerequisites.md](./01-prerequisites.md)               | Prerequisites (Deno, gh CLI)      |
| 2       | [02-climpt-setup.md](./02-climpt-setup.md)                 | Climpt installation and setup     |
| 3       | [03-instruction-creation.md](./03-instruction-creation.md) | Creating instructions (prompts)   |
| 4       | [04-iterate-agent-setup.md](./04-iterate-agent-setup.md)   | Iterate Agent setup and execution |

### Detailed Explanations (Advanced)

| Chapter | File                                               | Content                                                |
| ------- | -------------------------------------------------- | ------------------------------------------------------ |
| 5       | [05-architecture.md](./05-architecture.md)         | Overview (architecture, execution flow)                |
| 6       | [06-config-files.md](./06-config-files.md)         | Config files (app.yml, user.yml)                       |
| 7       | [07-dependencies.md](./07-dependencies.md)         | Dependencies (registry, MCP, packages)                 |
| 8       | [08-prompt-structure.md](./08-prompt-structure.md) | Prompt structure (manual creation, template variables) |

## Overview

Climpt consists of five layers, enabling autonomous execution with Iterate Agent
at the top.

- **Top Layer**: Iterator/Reviewer Agent -- connects with GitHub Issue/Project,
  iterates
  - **Middle Layer**: delegate-climpt-agent Skill -- command search, option
    resolution
    - **Execution Layer**: Sub-Agent (climpt-agent.ts) -- retrieves prompt,
      works autonomously
      - **Tool Layer**: CLI / MCP -- interface for prompt retrieval
        - **Config Layer**: registry.json / prompts/ -- prompt templates and
          command definitions

### Execution Flow

1. **Top Layer**: Iterate Agent retrieves requirements from GitHub Issue/Project
2. **Middle Layer**: delegate-climpt-agent Skill searches commands and resolves
   options
3. **Execution Layer**: Sub-Agent retrieves prompt and executes work
   autonomously
4. **Tool Layer**: CLI/MCP loads prompts from config layer
5. **Config Layer**: Replaces template variables to generate final prompt

**Key Point**: Top and Execution layers run in separate Claude Agent SDK
sessions, achieving flexible autonomous operation through context separation.
See [05-architecture.md](./05-architecture.md) for details.

## Setup Flow

1. **Prepare Prerequisites** -- Install Deno 2.x, GitHub CLI (gh), authenticate
   gh
2. **Climpt Setup** -- Install Climpt, initialize with `climpt init`, install
   Claude Code plugin
3. **Create Instructions** (Optional) -- Create with `meta create instruction`,
   generate frontmatter with `meta build frontmatter`, regenerate registry with
   `/reg`
4. **Run Iterate Agent** -- Initialize with `iterate-agent --init`, execute with
   `--issue` or `--project`
5. **Understanding the System** (Advanced) -- Architecture, config files,
   dependencies, prompt structure
