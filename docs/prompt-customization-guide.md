# Prompt Customization Guide

This guide explains how to customize prompts for Climpt agents (Iterator,
Reviewer, etc.).

## Overview

Climpt agents use an external prompt system that allows you to:

1. **Customize prompts** by placing files in `.agent/{agent}/prompts/`
2. **Use variable substitution** with `{uv-xxx}` and `{input_text}` placeholders
3. **Fall back to built-in prompts** when custom prompts don't exist

## Directory Structure

Each agent has its own prompt directory under `.agent/`:

```
.agent/
├── iterator/
│   ├── prompts/
│   │   └── steps/           # Step prompts (c1)
│   │       ├── initial/     # Initial phase (c2)
│   │       │   ├── issue/   # Issue mode (c3)
│   │       │   │   └── f_default.md
│   │       │   └── project/ # Project mode (c3)
│   │       │       ├── f_preparation.md
│   │       │       ├── f_preparation_empty.md
│   │       │       ├── f_review.md
│   │       │       └── f_complete.md
│   │       ├── continuation/
│   │       │   ├── issue/
│   │       │   └── project/
│   │       └── section/
│   │           └── project/
│   │               └── f_context.md
│   └── steps_registry.json
├── reviewer/
│   ├── prompts/
│   │   └── steps/
│   │       ├── initial/
│   │       │   └── default/
│   │       │       └── f_default.md
│   │       └── continuation/
│   │           └── default/
│   │               └── f_default.md
│   └── steps_registry.json
└── facilitator/
    └── prompts/
        └── steps/
            ├── initial/
            └── continuation/
```

## C3L Path Structure

Prompt paths follow the C3L (Command 3-Level) naming convention:

| Level | Name   | Description     | Examples                             |
| ----- | ------ | --------------- | ------------------------------------ |
| c1    | Domain | Prompt category | `steps`, `dev`                       |
| c2    | Action | Execution phase | `initial`, `continuation`, `section` |
| c3    | Target | Mode/target     | `issue`, `project`, `iterate`        |

### File Naming Convention

Prompt files follow this pattern:

- **With adaptation**: `f_{edition}_{adaptation}.md`
- **Without adaptation**: `f_{edition}.md`

Examples:

- `f_default.md` - Default edition prompt
- `f_preparation.md` - Preparation phase prompt
- `f_preparation_empty.md` - Preparation with "empty" adaptation
- `f_review.md` - Review phase prompt

## Variable Substitution

### UV Variables (`{uv-xxx}`)

User Variables are agent-specific values passed at runtime:

| Variable                    | Agent             | Description                   |
| --------------------------- | ----------------- | ----------------------------- |
| `{uv-issue_number}`         | Iterator          | GitHub issue number           |
| `{uv-project_number}`       | Iterator          | GitHub project number         |
| `{uv-project_title}`        | Iterator          | Project title                 |
| `{uv-label_info}`           | Iterator          | Label information             |
| `{uv-completed_iterations}` | Iterator/Reviewer | Count of completed iterations |
| `{uv-total_issues}`         | Iterator          | Total issues in project       |
| `{uv-current_index}`        | Iterator          | Current issue index           |
| `{uv-iterations}`           | Iterator          | Target iteration count        |
| `{uv-project}`              | Reviewer          | Project identifier            |
| `{uv-iteration}`            | Reviewer          | Current iteration number      |

### STDIN Input (`{input_text}`)

For steps that accept STDIN input, use `{input_text}` to insert the input
content.

### Custom Variables

Some prompts support custom variables for runtime-generated content:

| Variable                    | Description              |
| --------------------------- | ------------------------ |
| `{project_context_section}` | Inserted project context |
| `{issue_content}`           | GitHub issue body        |
| `{cross_repo_note}`         | Cross-repository notes   |

## Creating Custom Prompts

### Step 1: Find the Step ID

Check the agent's `steps_registry.json` to find the step you want to customize:

```json
{
  "steps": {
    "initial.issue": {
      "stepId": "initial.issue",
      "name": "Issue Initial Prompt",
      "c2": "initial",
      "c3": "issue",
      "edition": "default",
      "uvVariables": ["issue_number"],
      "usesStdin": false
    }
  }
}
```

### Step 2: Create the Prompt File

Create a file at the correct path:

```
.agent/{agent}/prompts/{c1}/{c2}/{c3}/f_{edition}.md
```

For the example above:

```
.agent/iterator/prompts/steps/initial/issue/f_default.md
```

### Step 3: Add Frontmatter (Optional)

Include YAML frontmatter for documentation:

```markdown
---
stepId: initial.issue
name: Issue Initial Prompt
description: Initial prompt when working on a single GitHub issue
uvVariables:
  - issue_number
customVariables:
  - project_context_section
  - issue_content
---

Your prompt content here...
```

### Step 4: Use Variables

Include UV variables in your prompt:

```markdown
## Current Task: Issue #{uv-issue_number}

{issue_content}

Please complete this issue following these steps...
```

## Examples

### Custom Iterator Issue Prompt

```markdown
---
stepId: initial.issue
name: Custom Issue Prompt
---

# Working on Issue #{uv-issue_number}

{issue_content}

## My Custom Workflow

1. Read the issue carefully
2. Create a plan using TodoWrite
3. Implement changes step by step
4. Report progress regularly

## Completion Criteria

- All requirements from the issue are met
- Tests pass
- Code is committed
```

### Custom Reviewer Prompt

```markdown
---
stepId: initial.default
name: Custom Review Prompt
---

# Code Review Session

Project: {uv-project}

## Review Checklist

1. Check code style and formatting
2. Verify test coverage
3. Review documentation
4. Assess performance implications

## Report Format

Use issue-action blocks to report findings.
```

## Step Registry Reference

### Iterator Steps

| Step ID                       | Description                | UV Variables                                                                        |
| ----------------------------- | -------------------------- | ----------------------------------------------------------------------------------- |
| `initial.issue`               | Issue mode initial prompt  | `issue_number`                                                                      |
| `continuation.issue`          | Issue mode continuation    | `issue_number`, `completed_iterations`                                              |
| `initial.project.preparation` | Project preparation phase  | `project_number`, `project_title`, `label_info`, `total_issues`                     |
| `initial.project.review`      | Project review phase       | `project_number`, `project_title`, `label_info`, `issues_completed`, `label_filter` |
| `initial.project.complete`    | Project completion message | `project_number`, `label_info`, `issues_completed`                                  |
| `section.projectcontext`      | Project context section    | `project_number`, `project_title`, `label_info`, `current_index`, `total_issues`    |
| `initial.iterate`             | Iterate mode initial       | `iterations`                                                                        |
| `continuation.iterate`        | Iterate mode continuation  | `completed_iterations`, `remaining`                                                 |

### Reviewer Steps

| Step ID                | Description           | UV Variables                                    |
| ---------------------- | --------------------- | ----------------------------------------------- |
| `initial.default`      | Initial review prompt | `project`, `requirements_label`, `review_label` |
| `continuation.default` | Continuation review   | `iteration`                                     |

## Fallback Behavior

When a custom prompt file doesn't exist:

1. The system checks for user prompt at `.agent/{agent}/prompts/{path}`
2. If not found, uses the embedded fallback prompt
3. Variables are still substituted in fallback prompts

## Testing Custom Prompts

Use the breakdown CLI to test prompt resolution:

```bash
# Test with breakdown CLI
deno task cli iterator-steps initial issue --format prompt
```

## Troubleshooting

### Prompt Not Found

- Verify the file path matches the C3L structure
- Check that the filename follows `f_{edition}.md` pattern
- Ensure `steps_registry.json` has the correct step definition

### Variables Not Substituted

- Confirm variable names match exactly (e.g., `{uv-issue_number}` not
  `{uv-issue-number}`)
- Check that required UV variables are passed by the agent
- Verify the step definition lists all required variables

### Frontmatter Issues

- Use `---` delimiters correctly
- Keep frontmatter YAML valid
- Frontmatter is stripped before use; content starts after the closing `---`

## Related Documentation

- [Prompt Architecture (Internal)](./internal/prompt-architecture.md)
- [Registry Specification](./internal/registry-specification.md)
- [Iterator Agent Design](./internal/iterate-agent-design.md)
