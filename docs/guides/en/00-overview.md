[English](../en/00-overview.md) | [日本語](../ja/00-overview.md)

# Iterate Agent Introduction Guide

A guide for building an autonomous development environment that automatically processes GitHub Issues and Projects using Climpt and Iterate Agent.

## Target Audience

- Those interested in AI-assisted development automation
- Those who want to automate GitHub Issue/Project-based development workflows
- Those considering development efficiency improvements using Claude Code

## Guide Structure

This guide is divided into the following files for step-by-step environment setup:

| Chapter | File | Content |
|---------|------|---------|
| 1 | [01-prerequisites.md](./01-prerequisites.md) | Prerequisites (Deno, gh CLI) |
| 2 | [02-climpt-setup.md](./02-climpt-setup.md) | Climpt installation and setup |
| 3 | [03-instruction-creation.md](./03-instruction-creation.md) | Creating instructions (prompts) |
| 4 | [04-iterate-agent-setup.md](./04-iterate-agent-setup.md) | Iterate Agent setup and execution |

### Detailed Explanations (Advanced)

| Chapter | File | Content |
|---------|------|---------|
| 5 | [05-architecture.md](./05-architecture.md) | Overview (architecture, execution flow) |
| 6 | [06-config-files.md](./06-config-files.md) | Config files (app.yml, user.yml) |
| 7 | [07-dependencies.md](./07-dependencies.md) | Dependencies (registry, MCP, packages) |
| 8 | [08-prompt-structure.md](./08-prompt-structure.md) | Prompt structure (manual creation, template variables) |

## Overview

```
┌────────────────────────────────────────────────────────────────┐
│                     Iterate Agent System                        │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐     │
│  │   GitHub     │    │   Climpt     │    │  Claude Code │     │
│  │ Issue/Project│───▶│   Skills     │───▶│   Plugin     │     │
│  └──────────────┘    └──────────────┘    └──────────────┘     │
│         │                   │                   │              │
│         │                   ▼                   │              │
│         │           ┌──────────────┐            │              │
│         │           │ Instructions │            │              │
│         │           │  (Prompts)   │            │              │
│         │           └──────────────┘            │              │
│         │                   │                   │              │
│         ▼                   ▼                   ▼              │
│  ┌─────────────────────────────────────────────────────┐      │
│  │              Iterate Agent (Autonomous)             │      │
│  │                                                     │      │
│  │  1. Get requirements from Issue/Project            │      │
│  │  2. Execute tasks via delegate-climpt-agent Skill  │      │
│  │  3. Check completion criteria                      │      │
│  │  4. If incomplete, proceed to next task            │      │
│  └─────────────────────────────────────────────────────┘      │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

## Setup Flow

```
1. Prepare Prerequisites
   ├── Install Deno 2.x
   ├── Install GitHub CLI (gh)
   └── Authenticate gh

2. Climpt Setup
   ├── Install Climpt
   ├── Initialize with climpt init
   └── Install Claude Code plugin

3. Create Instructions (Optional)
   ├── Create new with meta create instruction
   ├── Generate frontmatter with meta build frontmatter
   └── Regenerate registry with /reg

4. Run Iterate Agent
   ├── Initialize with iterate-agent --init
   └── Execute with --issue or --project

5. Understanding the System (Advanced)
   ├── Overview: Architecture and execution flow
   ├── Config Files: app.yml, user.yml details
   ├── Dependencies: Registry, MCP, package relationships
   └── Prompt Structure: Manual creation, template variables
```

## Requirements

| Requirement | Minimum Version | Purpose |
|-------------|-----------------|---------|
| Deno | 2.x | Climpt runtime |
| GitHub CLI (gh) | 2.x | GitHub API access |
| Claude Code | Latest | AI-assisted development |

## Estimated Time

- Prerequisites preparation: 10-15 minutes
- Climpt setup: 5-10 minutes
- Instruction creation: As needed
- Iterate Agent execution: Immediate

## Next Step

Proceed to [01-prerequisites.md](./01-prerequisites.md) to prepare the prerequisites.
