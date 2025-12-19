# Skills & Claude Agent SDK

This directory contains Claude Code Skills that extend Claude's capabilities for Climpt integration.

## What are Skills?

Agent Skills are modular capabilities that extend Claude's functionality. Each Skill packages instructions, metadata, and optional resources that Claude uses automatically when relevant to user requests.

### Key Benefits

- **Specialize Claude**: Tailor capabilities for domain-specific tasks
- **Reduce Repetition**: Create once, use automatically
- **Compose Capabilities**: Combine Skills to build complex workflows

## Skill Structure

Every Skill requires a `SKILL.md` file with YAML frontmatter:

```
skills/
└── my-skill-name/
    ├── SKILL.md          # Required: Skill definition
    ├── scripts/          # Optional: Executable scripts
    │   └── helper.ts
    └── resources/        # Optional: Reference materials
        └── templates/
```

### SKILL.md Format

```yaml
---
name: skill-name
description: Brief description of what this Skill does and when to use it
---

# Skill Name

## Instructions

[Clear, step-by-step guidance for Claude to follow]

## Examples

[Concrete examples of using this Skill]
```

### Field Requirements

**name**:
- Maximum 64 characters
- Lowercase letters, numbers, and hyphens only
- Cannot contain "anthropic" or "claude"

**description**:
- Maximum 1024 characters
- Must describe both what the Skill does and when to use it

## How Skills Work

Skills use progressive disclosure - loading content only when needed:

| Level | When Loaded | Content |
|-------|-------------|---------|
| **Metadata** | At startup | `name` and `description` from frontmatter |
| **Instructions** | When triggered | SKILL.md body content |
| **Resources** | As needed | Scripts, templates, reference files |

## Using Skills with Claude Agent SDK

### TypeScript

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "Help me commit my changes",
  options: {
    cwd: "/path/to/project",
    settingSources: ["user", "project"],
    allowedTools: ["Skill", "Read", "Write", "Bash"]
  }
})) {
  console.log(message);
}
```

### Python

```python
import asyncio
from claude_agent_sdk import query, ClaudeAgentOptions

async def main():
    options = ClaudeAgentOptions(
        cwd="/path/to/project",
        setting_sources=["user", "project"],
        allowed_tools=["Skill", "Read", "Write", "Bash"]
    )

    async for message in query(
        prompt="Help me commit my changes",
        options=options
    ):
        print(message)

asyncio.run(main())
```

### Key Configuration

- **settingSources**: Load Skills from `"user"` (~/.claude/skills/) and/or `"project"` (.claude/skills/)
- **allowedTools**: Must include `"Skill"` to enable Skills

## Skill Locations

Skills are discovered from:

| Location | Scope | Path |
|----------|-------|------|
| Project Skills | Shared via git | `.claude/skills/` |
| User Skills | Personal, all projects | `~/.claude/skills/` |
| Plugin Skills | Bundled with plugins | Plugin's `skills/` directory |

## Creating a New Skill

### Step 1: Create Directory

```bash
mkdir -p climpt-plugins/skills/my-new-skill
```

### Step 2: Create SKILL.md

```markdown
---
name: my-new-skill
description: Describe what this skill does and when Claude should use it
---

# My New Skill

## Overview

Brief explanation of the skill's purpose.

## Workflow

### Step 1: First Action

Instructions for Claude to follow.

### Step 2: Next Action

More instructions.

## Examples

Show concrete usage examples.
```

### Step 3: Add Scripts (Optional)

```typescript
// scripts/helper.ts
export function processData(input: string): string {
  // Processing logic
  return result;
}
```

### Step 4: Test the Skill

Ask Claude questions that match your Skill's description to verify it triggers correctly.

## Climpt Agent Skill Example

The `delegate-climpt-agent` skill demonstrates MCP integration:

```yaml
---
name: delegate-climpt-agent
description: Delegates development tasks to Climpt Agent. Use when user asks to perform git operations, create instructions, manage branches, generate frontmatter, or any development workflow that matches Climpt commands.
---
```

This Skill:
1. Receives user requests about development tasks
2. Searches Climpt command registry via MCP
3. Retrieves and executes matching instruction prompts
4. Guides Claude through the task completion

## Best Practices

### Writing Effective Descriptions

- Include **what** the Skill does
- Include **when** Claude should use it
- Use specific keywords that match user requests

```yaml
# Good
description: Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF files or when the user mentions PDFs, forms, or document extraction.

# Bad
description: PDF helper
```

### Organizing Content

- Keep SKILL.md focused and under 5k tokens
- Use separate files for detailed reference material
- Put reusable code in scripts/

### Security Considerations

- Only use Skills from trusted sources
- Review all bundled scripts before installation
- Be cautious with Skills that access external resources

## Troubleshooting

### Skill Not Found

1. Verify `settingSources` includes the correct locations
2. Check `cwd` points to the project root
3. Verify SKILL.md exists in the correct path

```bash
# Check project Skills
ls .claude/skills/*/SKILL.md

# Check user Skills
ls ~/.claude/skills/*/SKILL.md
```

### Skill Not Triggering

1. Ensure `"Skill"` is in `allowedTools`
2. Verify description matches user request
3. Check for YAML frontmatter syntax errors

## Related Resources

- [Anthropic Skills Documentation](https://docs.anthropic.com/en/docs/agents-and-tools/agent-skills)
- [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk)
- [Skills Cookbook](https://github.com/anthropics/claude-cookbooks/tree/main/skills)
- [Climpt Plugin Documentation](../README.md)
