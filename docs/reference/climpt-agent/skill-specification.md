# Skill Specification (delegate-climpt-agent)

This document explains the technical specification of the `delegate-climpt-agent` Skill.

## SKILL.md Structure

### Frontmatter

```yaml
---
name: delegate-climpt-agent
description: Delegates development tasks to Climpt Agent. Use when user asks to perform git operations, create instructions, manage branches, generate frontmatter, or any development workflow that matches Climpt commands.
---
```

#### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Skill identifier (max 64 chars, lowercase, numbers, hyphens only) |
| `description` | string | Yes | Describes Skill triggering conditions (max 1024 chars) |

### Description Design Guidelines

The `description` is an important field that Claude uses to determine whether to trigger the Skill:

1. **List specific use cases**: git operations, branch management, frontmatter generation, etc.
2. **Use action verbs**: "delegates", "use when user asks", etc.
3. **Include domain-specific terms**: Climpt, git commits, PR workflows, etc.

## Workflow

### Step 1: Command Search

```
mcp__climpt__search({
  "query": "<user intent>",
  "agent": "climpt"
})
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Natural language search query |
| `agent` | string | Yes | Always `"climpt"` |

**Response:**

```json
[
  {
    "c1": "git",
    "c2": "group-commit",
    "c3": "unstaged-changes",
    "description": "Group file changes by semantic proximity...",
    "score": 0.85
  }
]
```

### Step 2: Get Command Details

```
mcp__climpt__describe({
  "agent": "climpt",
  "c1": "git",
  "c2": "group-commit",
  "c3": "unstaged-changes"
})
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agent` | string | Yes | Always `"climpt"` |
| `c1` | string | Yes | Domain identifier |
| `c2` | string | Yes | Action identifier |
| `c3` | string | Yes | Target identifier |

**Response:**

```json
{
  "c1": "git",
  "c2": "group-commit",
  "c3": "unstaged-changes",
  "description": "Group file changes by semantic proximity...",
  "usage": "climpt-git group-commit unstaged-changes",
  "options": {
    "edition": ["default"],
    "adaptation": ["default", "detailed"],
    "file": true,
    "stdin": false,
    "destination": true
  }
}
```

### Step 3: Execute Command

```
mcp__climpt__execute({
  "agent": "climpt",
  "c1": "git",
  "c2": "group-commit",
  "c3": "unstaged-changes",
  "options": {}
})
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agent` | string | Yes | Always `"climpt"` |
| `c1` | string | Yes | Domain identifier |
| `c2` | string | Yes | Action identifier |
| `c3` | string | Yes | Target identifier |
| `options` | object | No | Command options |

**Response:**

Instruction document (prompt) is returned as text.

## C3L Naming Convention

Commands follow the C3L (Command 3-Level) naming convention:

### Level Definitions

| Level | Description | Pattern | Examples |
|-------|-------------|---------|----------|
| `agent` | MCP server identifier | - | `climpt`, `inspector` |
| `c1` | Domain identifier | `<domain>` | `git`, `meta`, `spec` |
| `c2` | Action identifier | `<verb>-<modifier>?` | `group-commit`, `build`, `create` |
| `c3` | Target identifier | `<noun>-<qualifier>?` | `unstaged-changes`, `frontmatter` |

### Naming Pattern

**Sub-agent name generation:**

```
<agent>-<c1>-<c2>-<c3>
```

**Examples:**

| agent | c1 | c2 | c3 | Sub-agent Name |
|-------|----|----|-----|----------------|
| `climpt` | `git` | `group-commit` | `unstaged-changes` | `climpt-git-group-commit-unstaged-changes` |
| `climpt` | `meta` | `build` | `frontmatter` | `climpt-meta-build-frontmatter` |
| `climpt` | `meta` | `create` | `instruction` | `climpt-meta-create-instruction` |

## Triggering Conditions

The Skill auto-triggers under the following conditions:

1. **Git operation related**
   - "commit this", "group the changes"
   - "decide the branch", "organize branches"
   - "check the PR", "merge this"

2. **Meta operation related**
   - "generate frontmatter"
   - "create instruction"

3. **General workflows**
   - "run the development flow"
   - "execute Climpt command"

## Error Handling

### No Search Results

```markdown
Climpt command not found.
- Try rephrasing the query
- Run `mcp__climpt__reload` to update the registry
```

### Execution Error

```markdown
Command execution failed: <error message>
- Check command parameters
- Verify Climpt CLI is properly installed
```

## Best Practices

1. **Be specific with search queries**: "commit changes" → "group semantically related files and commit" improves accuracy
2. **When there are multiple candidates**: Compare score and description to select the optimal command
3. **Use options**: Appropriately configure edition, adaptation, etc. for customization
