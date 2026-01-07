# Review Agent

Autonomous agent that verifies implementation against requirements and creates
issues for any identified gaps.

## Overview

Review Agent is a companion to [iterate-agent](../iterator/). While
iterate-agent implements features, review-agent verifies that implementations
meet requirements and creates issues for any gaps found.

### Key Features

- **Read-only**: Never modifies implementation code
- **Label-based**: Uses `docs` label for requirements, `review` label for
  targets
- **Traceable**: Links gaps to traceability IDs
- **Autonomous**: Runs without human intervention

## Label System

The review-agent uses a label-based workflow:

| Label                | Purpose                                                         |
| -------------------- | --------------------------------------------------------------- |
| `docs`               | Issues containing requirements/specifications (source of truth) |
| `review`             | Issues that need implementation review (review targets)         |
| `implementation-gap` | Created by reviewer for identified gaps                         |
| `from-reviewer`      | Marks issues created by the review-agent                        |

## Installation

Run directly via JSR:

```bash
deno run -A jsr:@aidevtool/climpt/agents/reviewer --project <number>
```

Or use the deno task:

```bash
deno task review-agent --project <number>
```

## Usage

### 1. Initialize Configuration

First, initialize the configuration files:

```bash
deno run -A jsr:@aidevtool/climpt/agents/reviewer --init
```

This creates:

- `agents/reviewer/config.json` - Agent configuration
- `agents/reviewer/prompts/default.md` - System prompt template

### 2. Run Review

Review implementation for a GitHub Project:

```bash
# Review project #25 (uses default labels: docs, review)
deno run -A jsr:@aidevtool/climpt/agents/reviewer --project 25

# Review with custom labels
deno run -A jsr:@aidevtool/climpt/agents/reviewer --project 25 \
  --requirements-label specs \
  --review-label check
```

### Parameters

| Parameter              | Required | Description                                        |
| ---------------------- | -------- | -------------------------------------------------- |
| `--project, -p`        | Yes      | GitHub Project number                              |
| `--requirements-label` | No       | Label for requirement issues (default: "docs")     |
| `--review-label`       | No       | Label for review target issues (default: "review") |
| `--name, -n`           | No       | Agent name (default: "reviewer")                   |
| `--iterate-max, -m`    | No       | Maximum iterations                                 |

## How It Works

### Phase 1: Context Gathering

1. Fetches issues with `docs` label as requirements/specifications
2. Fetches issues with `review` label as review targets
3. Extracts traceability IDs from requirement issues
4. Builds a checklist of expected implementations

### Phase 2: Implementation Analysis

1. Searches codebase for implementations related to requirements
2. Verifies functionality matches specification
3. Checks edge cases and error handling

### Phase 3: Gap Reporting

For each identified gap, creates an issue with:

- Gap summary
- Requirement reference (traceability ID)
- Source docs issue reference
- Current vs expected state
- Affected files

## Output

### Created Issues

Gap issues are created with labels:

- `implementation-gap`
- `from-reviewer`

### Review Summary

```
Starting review for GitHub Project #25
  Requirements label: 'docs'
  Review target label: 'review'

Iteration 1...
  Created gap issue #45: [Gap] Theme selection state not persisted
  Created gap issue #46: [Gap] Layout resize positions not saved

============================================================
Review Complete
============================================================

Iterations: 1
Gap issues created: 2

Created Issues:
  - #45
  - #46

Log file: tmp/logs/agents/reviewer/session-2025-01-02T12-00-00-000Z.jsonl
```

## Integration with iterate-agent

The review-agent and iterate-agent form a development cycle:

```
┌─────────────────────────────────────────────────────┐
│                 Development Cycle                    │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌──────────────┐         ┌──────────────┐          │
│  │ iterate-     │         │ review-      │          │
│  │ agent        │         │ agent        │          │
│  │              │         │              │          │
│  │ Implements   │         │ Reviews      │          │
│  └──────┬───────┘         └──────┬───────┘          │
│         │                        │                   │
│         │  Implementation        │                   │
│         ├───────────────────────▶│                   │
│         │                        │ Review            │
│         │                        │ (docs → review)   │
│         │    Gap Issues          │                   │
│         │◀───────────────────────┤                   │
│         │                        │                   │
│         │  Fix Gaps              │                   │
│         ├───────────────────────▶│                   │
│         │                        │ Re-review         │
│         │                        │                   │
│                                                      │
└─────────────────────────────────────────────────────┘
```

## Configuration

### config.json

```json
{
  "version": "1.0.0",
  "agents": {
    "reviewer": {
      "systemPromptTemplate": "agents/reviewer/prompts/default.md",
      "allowedTools": ["Skill", "Read", "Glob", "Grep", "Bash", "WebFetch"],
      "permissionMode": "plan"
    }
  },
  "github": {
    "apiVersion": "2022-11-28",
    "labels": {
      "requirements": "docs",
      "review": "review",
      "gap": "implementation-gap",
      "reviewer": "from-reviewer"
    }
  },
  "logging": {
    "directory": "tmp/logs/agents/reviewer",
    "maxFiles": 100,
    "format": "jsonl"
  }
}
```

### Key Differences from iterate-agent

| Aspect           | iterate-agent            | review-agent                |
| ---------------- | ------------------------ | --------------------------- |
| CLI options      | `--issue` or `--project` | `--project` only            |
| `allowedTools`   | Includes Write, Edit     | Read-only (no Write, Edit)  |
| `permissionMode` | acceptEdits              | plan                        |
| Purpose          | Implement features       | Verify implementations      |
| Input            | Single issue or project  | Project with labeled issues |

> **Note**: review-agent does not support `--issue` option. It is designed to
> review an entire project's implementation by fetching all issues with `docs`
> (requirements) and `review` (targets) labels. Use iterate-agent for
> single-issue work.

## Requirements

- Deno 1.40+
- `gh` CLI (https://cli.github.com) with authentication
- GitHub Project with labeled issues

## Traceability ID Format

Traceability IDs should follow this format in issue bodies:

```
req:<category>:<name>#<date>
```

Examples:

- `req:stock:data-mgmt-abc123#20251229`
- `req:theme:selection-def456#20251229`
- `req:layout:resize-ghi789#20251229`
