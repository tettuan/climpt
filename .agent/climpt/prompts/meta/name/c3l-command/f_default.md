---
c1: meta
c2: name
c3: c3l-command
title: Name C3L Command
description: Derive C3L-compliant command naming (c1, c2, c3) from requirements using C3L specification v0.5
usage: climpt-meta name c3l-command
c3l_version: "0.5"
options:
  edition:
    - default
  adaptation:
    - default
    - detailed
  file: false
  stdin: true
  destination: false
---

# Name C3L Command

## Purpose

Derive a C3L-compliant command name from given requirements. This command:
1. Analyzes the input requirements
2. References C3L specification v0.5
3. Outputs the appropriate c1, c2, c3 naming with rationale

## Input

Provide the following information via stdin:
- Purpose and description of the command
- What the command does (action)
- What the command acts upon (target)
- Intended domain context

## Received Input

{input_text}

## C3L Specification Reference

### Core Structure

C3L commands consist of **three semantic words**:

| Symbol | Role | Meaning | Pattern |
|--------|------|---------|---------|
| **c1** | Domain | Where the command operates | `^[a-z0-9]+$` |
| **c2** | Action | What operation is performed | `^[a-z0-9]+(-[a-z0-9]+)?$` |
| **c3** | Target | What is acted upon | `^[a-z0-9]+(-[a-z0-9]+)?$` |

### Common Domains (c1)

| Domain | Description |
|--------|-------------|
| `git` | Git operations |
| `code` | Code analysis, generation, transformation |
| `meta` | Meta operations, tooling, configuration |
| `data` | Data processing, fetching |
| `infra` | Infrastructure, deployment |
| `sec` | Security, auditing |
| `test` | Testing operations |
| `docs` | Documentation |

### Action Patterns (c2)

Format: `<verb>` or `<verb>-<modifier>`

| Type | Examples |
|------|----------|
| Single verb | `build`, `create`, `review`, `merge`, `fetch`, `analyze`, `name` |
| Compound | `group-commit`, `find-oldest`, `build-robust`, `convert-skill` |

### Target Patterns (c3)

Format: `<object>` or `<object>-<context>`

| Type | Examples |
|------|----------|
| Single object | `frontmatter`, `branch`, `service`, `instruction` |
| Compound | `pull-request`, `unstaged-changes`, `api-service`, `c3l-command` |

## Naming Process

### Step 1: Identify Domain (c1)

Analyze the input to determine the operational domain:
- What system or area does this command operate in?
- Choose from existing domains or define a new one if necessary

### Step 2: Identify Action (c2)

Determine the primary action:
- What verb describes the operation?
- Does it need a modifier for clarity?
- Prefer simple verbs when possible

### Step 3: Identify Target (c3)

Determine the target object:
- What does the action operate on?
- Does it need context for disambiguation?

### Step 4: Validate

Verify the naming:
1. Exactly 3 tokens
2. c1 matches `^[a-z0-9]+$`
3. c2 matches `^[a-z0-9]+(-[a-z0-9]+)?$`
4. c3 matches `^[a-z0-9]+(-[a-z0-9]+)?$`
5. No hyphens between tokens
6. **Natural English phrasing**: The command should read naturally as an English phrase
   - `<c2> <c3>` should form a natural verb-object pair (e.g., "review pull-request", "build frontmatter")
   - Avoid awkward or ungrammatical combinations
   - The full command `climpt-<c1> <c2> <c3>` should be intuitive to read aloud

## Output Format

Provide the C3L naming result in the following format:

### Naming Result

```yaml
c1: <domain>
c2: <action>
c3: <target>
usage: climpt-<c1> <c2> <c3>
```

### Rationale

- **c1 (<domain>)**: [Explanation of domain choice]
- **c2 (<action>)**: [Explanation of action choice]
- **c3 (<target>)**: [Explanation of target choice]

### Directory Structure

```
.agent/climpt/prompts/<c1>/<c2>/<c3>/f_default.md
```

## Examples

### Example 1: Code Review Command

Input: "Create a command to review pull request code changes"

Output:
```yaml
c1: code
c2: review
c3: pull-request
usage: climpt-code review pull-request
```

Rationale:
- **c1 (code)**: Operates on code/source files
- **c2 (review)**: The action is reviewing
- **c3 (pull-request)**: The target is pull request changes

### Example 2: Git Branch Cleanup

Input: "Create a command to find and delete old merged branches"

Output:
```yaml
c1: git
c2: cleanup
c3: merged-branches
usage: climpt-git cleanup merged-branches
```

Rationale:
- **c1 (git)**: Operates on Git repository
- **c2 (cleanup)**: The action is cleaning up
- **c3 (merged-branches)**: The target is merged branches

### Example 3: Documentation Generation

Input: "Create a command to generate API documentation from source code"

Output:
```yaml
c1: docs
c2: generate
c3: api-reference
usage: climpt-docs generate api-reference
```

Rationale:
- **c1 (docs)**: Operates in documentation domain
- **c2 (generate)**: The action is generating
- **c3 (api-reference)**: The target is API reference documentation
