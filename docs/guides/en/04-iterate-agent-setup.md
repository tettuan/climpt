[English](../en/04-iterate-agent-setup.md) |
[日本語](../ja/04-iterate-agent-setup.md)

# 4. Iterate Agent Setup and Execution

Set up and run Iterate Agent to automatically process GitHub Issues and
Projects.

## Contents

1. [What is Iterate Agent](#41-what-is-iterate-agent)
2. [Prerequisites](#42-prerequisites)
3. [Initialization](#43-initialization)
4. [Basic Usage](#44-basic-usage)
5. [Completion Criteria](#45-completion-criteria)
6. [Configuration Customization](#46-configuration-customization)
7. [Execution Report](#47-execution-report)
8. [Troubleshooting](#48-troubleshooting)

---

## 4.1 What is Iterate Agent

Iterate Agent is an autonomous development agent using the Claude Agent SDK. It
automatically repeats the following cycle:

```
┌─────────────────────────────────────────────────────────────┐
│                  Iterate Agent Operation                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Get requirements from GitHub Issue/Project             │
│                    ↓                                        │
│  2. Execute task via delegate-climpt-agent Skill           │
│                    ↓                                        │
│  3. Sub-agent performs development work                    │
│                    ↓                                        │
│  4. Evaluate results, check completion criteria            │
│                    ↓                                        │
│  5. Incomplete → Determine next task, return to 2          │
│     Complete   → Finish                                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Key Features

- **Autonomous Execution**: Operates without human intervention
- **GitHub Integration**: Works with Issues/Projects via `gh` CLI
- **Climpt Skills Integration**: Leverages existing Climpt infrastructure
- **Detailed Logging**: JSONL format, automatic rotation (max 100 files)
- **Flexible Completion**: Issue close, Project completion, or iteration count

---

## 4.2 Prerequisites

**Important**: Iterate Agent requires the following setup before use:

### Required

| Requirement              | Description                         | Verification                  |
| ------------------------ | ----------------------------------- | ----------------------------- |
| **GitHub CLI (`gh`)**    | Must be installed and authenticated | `gh auth status`              |
| **Git repository**       | Project must be a Git repository    | `git status`                  |
| **GitHub remote**        | Repository must be pushed to GitHub | `git remote -v`               |
| **Target Issue/Project** | Must exist on GitHub                | `gh issue list`               |
| **Claude Code Plugin**   | climpt-agent plugin installed       | Check `.claude/settings.json` |

### Claude Code Plugin Setup

The `delegate-climpt-agent` Skill requires the climpt-agent plugin:

```bash
# In Claude Code, run these slash commands:
/plugin marketplace add tettuan/climpt
/plugin install climpt-agent
```

After installation, your `.claude/settings.json` should include:

```json
{
  "plugins": {
    "marketplace": ["tettuan/climpt"],
    "installed": ["climpt-agent"]
  }
}
```

> **Note**: The agent will display a warning if the plugin is not installed but
> will continue to run with limited functionality.

### GitHub CLI Setup

```bash
# Install (macOS)
brew install gh

# Install (other platforms)
# See: https://cli.github.com/manual/installation

# Authenticate
gh auth login
```

### Verify Setup

```bash
# Check gh authentication
gh auth status

# Check git repository
git status

# Check GitHub remote
git remote -v

# List available issues
gh issue list
```

### Initialization Required

Before running Iterate Agent, you **must** run the initialization command:

```bash
deno run -A jsr:@aidevtool/climpt/agents/iterator --init
```

This creates the required configuration files. See
[Initialization](#43-initialization) for details.

---

## 4.3 Initialization

### Navigate to Project Directory

```bash
cd your-project
```

### Execute Initialization Command

```bash
deno run -A jsr:@aidevtool/climpt/agents/iterator --init
```

Example output:

```
Iterate Agent initialized successfully!

Created files:
  - agents/iterator/config.json
  - .agent/iterator/prompts/dev/*

Next steps:
  1. Review and customize the configuration in agents/iterator/config.json
  2. Install the Claude Code plugin (required for delegate-climpt-agent Skill):
     /plugin marketplace add tettuan/climpt
     /plugin install climpt-agent
  3. Run: deno run -A jsr:@aidevtool/climpt/agents/iterator --issue <number>

Note: Requires 'gh' CLI (https://cli.github.com) with authentication.
```

### Created Files

```
your-project/
├── agents/iterator/
│   └── config.json           # Main configuration
├── .agent/iterator/
│   └── prompts/dev/          # System prompts (C3L format)
└── tmp/
    └── logs/
        └── agents/           # Execution logs (auto-created)
```

---

## 4.4 Basic Usage

### Issue-Based Execution

Automatically execute until the specified Issue is closed:

```bash
deno run -A jsr:@aidevtool/climpt/agents/iterator --issue 123
```

Short form:

```bash
deno run -A jsr:@aidevtool/climpt/agents/iterator -i 123
```

### Project-Based Execution

Execute until all items in the Project are complete:

```bash
deno run -A jsr:@aidevtool/climpt/agents/iterator --project 5
```

Short form:

```bash
deno run -A jsr:@aidevtool/climpt/agents/iterator -p 5
```

### Limit Iteration Count

Stop after maximum 10 iterations:

```bash
deno run -A jsr:@aidevtool/climpt/agents/iterator --iterate-max 10
```

Short form:

```bash
deno run -A jsr:@aidevtool/climpt/agents/iterator -m 10
```

### Resume Session

Continue from previous session:

```bash
deno run -A jsr:@aidevtool/climpt/agents/iterator --issue 123 --resume
```

### Options List

| Option            | Short | Default          | Description                         |
| ----------------- | ----- | ---------------- | ----------------------------------- |
| `--init`          | -     | -                | Initialize config files             |
| `--issue`         | `-i`  | -                | Target GitHub Issue number          |
| `--project`       | `-p`  | -                | Target GitHub Project number        |
| `--iterate-max`   | `-m`  | Infinity         | Maximum iterations                  |
| `--name`          | `-n`  | `climpt`         | Agent name                          |
| `--project-owner` | `-o`  | Repository owner | Project owner (only with --project) |
| `--resume`        | `-r`  | false            | Resume previous session             |
| `--help`          | `-h`  | -                | Display help                        |

---

## 4.5 Completion Criteria

| Mode            | Completion Condition                                   | Check Method                    |
| --------------- | ------------------------------------------------------ | ------------------------------- |
| `--issue`       | Issue is closed (`label-only` setting: phase complete) | `gh issue view --json state`    |
| `--project`     | All items complete                                     | `gh project view --format json` |
| `--iterate-max` | Reached specified count                                | Internal counter                |

### Combination

Multiple conditions can be combined:

```bash
# Stop when Issue #123 is closed OR after 10 iterations
deno run -A jsr:@aidevtool/climpt/agents/iterator --issue 123 --iterate-max 10

# Work on a project owned by a different user/organization
deno run -A jsr:@aidevtool/climpt/agents/iterator --project 5 --project-owner my-org
```

### About --project-owner

Project numbers are scoped per project owner (user or organization). By default,
the repository owner's projects are used, but you can specify a different owner
with `--project-owner`:

```bash
# Your own projects (@me = authenticated user)
deno run -A jsr:@aidevtool/climpt/agents/iterator --project 5 --project-owner @me

# Organization's projects
deno run -A jsr:@aidevtool/climpt/agents/iterator --project 5 --project-owner my-org

# Another user's projects (requires access permission)
deno run -A jsr:@aidevtool/climpt/agents/iterator --project 5 --project-owner tettuan
```

---

## 4.6 Configuration Customization

### config.json

```json
{
  "version": "1.0.0",
  "agents": {
    "climpt": {
      "allowedTools": [
        "Skill",
        "Read",
        "Write",
        "Edit",
        "Bash",
        "Glob",
        "Grep"
      ],
      "permissionMode": "acceptEdits"
    }
  },
  "github": {
    "apiVersion": "2022-11-28"
  },
  "logging": {
    "directory": "tmp/logs/agents",
    "maxFiles": 100,
    "format": "jsonl"
  }
}
```

### Configuration Item Descriptions

| Item                | Description                  |
| ------------------- | ---------------------------- |
| `allowedTools`      | List of available tools      |
| `permissionMode`    | Permission mode              |
| `logging.directory` | Log output destination       |
| `logging.maxFiles`  | Maximum log files (rotation) |

### permissionMode Types

| Mode                | Description                              | Recommended Use                    |
| ------------------- | ---------------------------------------- | ---------------------------------- |
| `default`           | Confirmation required for all operations | Initial testing                    |
| `plan`              | Only planning allowed                    | Plan review                        |
| `acceptEdits`       | Auto-approve file edits                  | **Normal operation (recommended)** |
| `bypassPermissions` | Auto-approve all operations              | Full automation                    |

### System Prompt Customization

System prompts are located in `.agent/iterator/prompts/dev/` using C3L format:

| File                          | Purpose                         |
| ----------------------------- | ------------------------------- |
| `start/default/f_default.md`  | Iteration-count based mode      |
| `start/issue/f_default.md`    | Single GitHub Issue mode        |
| `start/project/f_default.md`  | GitHub Project preparation mode |
| `review/project/f_default.md` | Project completion review mode  |

These prompts use UV variables for dynamic content injection (e.g.,
`{uv-agent_name}`, `{uv-completion_criteria}`).

The default system.md template includes `{uv-completion_criteria}`, which is
automatically populated by the completion handler at runtime. If you want to
define custom completion criteria, replace `{uv-completion_criteria}` with your
own text directly in system.md.

### About the --agent Option

The `--agent` option specifies a registry name defined in
`registry_config.json`:

```json
// .agent/climpt/config/registry_config.json
{
  "registries": {
    "climpt": ".agent/climpt/registry.json",
    "iterator": ".agent/iterator/registry.json"
  }
}
```

| --agent value | Registry used                   |
| ------------- | ------------------------------- |
| `climpt`      | `.agent/climpt/registry.json`   |
| `iterator`    | `.agent/iterator/registry.json` |

---

## 4.7 Execution Report

A detailed report is displayed upon completion:

```
📊 Execution Report
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⏱️  Performance
  | Metric         | Value          | Source              |
  |----------------|----------------|---------------------|
  | Total Time     | 328s (~5.5min) | SDK `duration_ms`   |
  | API Time       | 241s (~4min)   | SDK internal        |
  | Turns          | 28             | SDK `num_turns`     |
  | Iterations     | 1              | Agent runner        |
  | Total Cost     | $0.82 USD      | SDK `total_cost_usd`|

📈 Token Usage
  | Model            | Input  | Output | Cache Read | Cost  |
  |------------------|--------|--------|------------|-------|
  | claude-opus-4-5  | 3,120  | 6,000  | 663,775    | $0.79 |
  | claude-haiku-4-5 | 32,380 | 656    | 0          | $0.04 |

📋 Activity
  | Metric         | Value |
  |----------------|-------|
  | Log Entries    | 142   |
  | Errors         | 2     |
  | Issue Updates  | 3     |
  | Project Updates| 1     |
  | Completion     | ✅ criteria_met |

🛠️  Tools Used
  - Edit: 12
  - Bash: 8
  - Read: 25
  - Grep: 15
```

### Log Files

Logs are saved in JSONL format:

```
tmp/logs/agents/climpt/session-2025-12-31T10-00-00-000Z.jsonl
```

#### Log Output in Worktree Mode

When running agents in worktree mode (`forceWorktree: true`), logs are always
written to the **main repository's** `tmp/logs/` directory, not within the
worktree directory.

```
# Main repository (where you started the agent)
your-project/
├── tmp/
│   └── logs/
│       └── agents/
│           └── climpt/
│               └── session-*.jsonl  ← Logs are written here
│
# Worktree (where the agent performs work)
../worktree/feature-branch/
├── src/
└── ...                              ← No logs in worktree
```

This ensures:

- **Centralized logging**: All logs are in one location regardless of execution
  mode
- **No git pollution**: Worktree directories remain clean for commits
- **Easy access**: Logs are accessible even after worktree cleanup

> **Note**: The `tmp/` directory is included in `.gitignore`, so logs are never
> committed.

Viewing logs:

```bash
# Display latest log
cat tmp/logs/agents/climpt/session-*.jsonl | jq .

# Extract errors only
cat tmp/logs/agents/climpt/session-*.jsonl | jq 'select(.level == "error")'

# Assistant responses only
cat tmp/logs/agents/climpt/session-*.jsonl | jq 'select(.level == "assistant")'
```

---

## 4.8 Troubleshooting

### gh command not found

GitHub CLI is not installed:

```bash
# macOS
brew install gh

# Authenticate
gh auth login
```

→ See [01-prerequisites.md](./01-prerequisites.md)

### Configuration file not found

Run from project root:

```bash
cd your-project
deno run -A jsr:@aidevtool/climpt/agents/iterator --init
```

### Empty output from breakdown CLI

Verify prompt templates exist:

```bash
ls -la .agent/iterator/prompts/dev/
```

If not found, re-run `--init`:

```bash
deno run -A jsr:@aidevtool/climpt/agents/iterator --init
```

### Permission denied error

Check `permissionMode` in `config.json`:

```json
{
  "agents": {
    "climpt": {
      "permissionMode": "acceptEdits"
    }
  }
}
```

### gh auth status fails

Re-authenticate with GitHub CLI:

```bash
gh auth logout
gh auth login
```

### Project not found

Verify Project number and owner:

```bash
# List projects
gh project list --owner @me
```

### Issue not found

Verify Issue number:

```bash
# List issues
gh issue list
```

---

## Register as Deno Task (Recommended)

For frequent use, add task to `deno.json`:

```json
{
  "tasks": {
    "iterate-agent": "deno run -A jsr:@aidevtool/climpt/agents/iterator"
  }
}
```

Execution:

```bash
deno task iterate-agent --issue 123
deno task iterate-agent --project 5 --iterate-max 10
```

---

## Next Steps

- Try Iterate Agent on an actual Issue
- Customize system prompt for your project
- Create custom instructions to extend Climpt Skills

## Related Documentation

- [Iterate Agent Detailed Reference](../../agents/iterator/README.md)

---

## Support

If you encounter issues, please create an Issue:
https://github.com/tettuan/climpt/issues
