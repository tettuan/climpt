---
c1: climpt-meta
c2: build
c3: frontmatter
title: Build C3L Prompt Frontmatter
description: Generate C3L v0.5 compliant frontmatter for Climpt instruction files
usage: climpt-meta build frontmatter
c3l_version: "0.5"
options:
  edition:
    - default
  adaptation:
    - default
    - detailed
  file: false
  stdin: true
  destination: true
---

# Build C3L Prompt Frontmatter

## Purpose

Generate valid C3L v0.5 compliant YAML frontmatter for new Climpt instruction files. All frontmatter fields MUST be written in English.

## Input

Provide the following information via stdin:
- Intended command purpose and description
- Target domain (code, git, meta, data, infra, etc.)
- Action verb (what the command does)
- Target object (what the command acts upon)

## Output

A complete YAML frontmatter block ready to be placed at the top of a markdown instruction file.

## C3L v0.5 Frontmatter Schema

### Required Fields

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `c1` | string | Agent-Domain: `<agent>-<domain>` format | `climpt-git` |
| `c2` | string | Action: verb or verb-modifier | `group-commit` |
| `c3` | string | Target: object or object-context | `unstaged-changes` |
| `title` | string | Human-readable title (English) | `Group Commit Unstaged Changes` |

### Optional Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `description` | string | - | Detailed description of the command (English) |
| `usage` | string | - | Usage example: `<c1> <c2> <c3>` |
| `c3l_version` | string | `"0.5"` | C3L specification version |
| `options` | object | - | Command options configuration |

### Options Structure

```yaml
options:
  edition:      # Available edition variants
    - default
  adaptation:   # Available adaptation levels
    - default
    - detailed
  file: false   # Whether command accepts file input (-f)
  stdin: false  # Whether command accepts stdin input
  destination: false  # Whether command supports destination output (-o)
```

## Naming Conventions

### c1 (Agent-Domain)

Format: `<agent>-<domain>`

- Agent names: `climpt` (default), `inspector`, `auditor`, `builder`, `curator`, `planner`
- Domain examples: `code`, `git`, `data`, `meta`, `infra`, `sec`, `test`, `docs`

Pattern: `^[a-z]+-[a-z]+$`

### c2 (Action)

Format: `<verb>` or `<verb>-<modifier>`

Examples:
- Single verb: `build`, `review`, `merge`, `fetch`, `analyze`
- With modifier: `group-commit`, `find-oldest`, `build-robust`

Pattern: `^[a-z]+(-[a-z]+)?$`

### c3 (Target)

Format: `<object>` or `<object>-<context>`

Examples:
- Single object: `frontmatter`, `branch`, `service`
- With context: `pull-request`, `unstaged-changes`, `api-service`

Pattern: `^[a-z]+(-[a-z]+)?$`

## Example Output

```yaml
---
c1: climpt-code
c2: review
c3: pull-request
title: Review Pull Request Code
description: Review pull request changes and provide improvement suggestions and bug identification
usage: climpt-code review pull-request
c3l_version: "0.5"
options:
  edition:
    - default
  adaptation:
    - default
    - detailed
  file: true
  stdin: false
  destination: false
---
```

## Language Requirement

**IMPORTANT**: All frontmatter values MUST be written in English:
- `title`: English title
- `description`: English description
- Field names and values use lowercase English with hyphens

## Validation Rules

1. Exactly 3 semantic tokens (c1, c2, c3) before options
2. c1 MUST match `<agent>-<domain>` format
3. Hyphens allowed only within tokens, not between them
4. All string values in English
5. c3l_version should be quoted: `"0.5"`
