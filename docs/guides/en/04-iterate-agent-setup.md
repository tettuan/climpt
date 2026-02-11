[English](../en/04-iterate-agent-setup.md) |
[日本語](../ja/04-iterate-agent-setup.md)

# 4. Iterate Agent Setup and Execution

Set up and run Iterate Agent to automatically process GitHub Issues and
Projects.

## 4.1 What is Iterate Agent

Iterate Agent is an autonomous development agent using the Claude Agent SDK. It
automatically repeats the following cycle:

1. Get requirements from GitHub Issue/Project
2. Execute task via delegate-climpt-agent Skill
3. Sub-agent performs development work
4. Evaluate results, check completion criteria
5. Incomplete: determine next task, return to step 2. Complete: finish.

### Key Features

- **Autonomous Execution**: Operates without human intervention
- **GitHub Integration**: Works with Issues/Projects via `gh` CLI
- **Climpt Skills Integration**: Leverages existing Climpt infrastructure
- **Detailed Logging**: JSONL format, automatic rotation (max 100 files)
- **Flexible Completion**: Issue close, Project completion, or iteration count

---

## 4.2 Prerequisites

**Important**: Iterate Agent requires the following setup before use:

| Requirement              | Description                         | Verification                  |
| ------------------------ | ----------------------------------- | ----------------------------- |
| **GitHub CLI (`gh`)**    | Must be installed and authenticated | `gh auth status`              |
| **Git repository**       | Project must be a Git repository    | `git status`                  |
| **GitHub remote**        | Repository must be pushed to GitHub | `git remote -v`               |
| **Target Issue/Project** | Must exist on GitHub                | `gh issue list`               |
| **Claude Code Plugin**   | climpt-agent plugin installed       | Check `.claude/settings.json` |

The `delegate-climpt-agent` Skill requires the climpt-agent plugin:

```bash
# In Claude Code, run these slash commands:
/plugin marketplace add tettuan/climpt
/plugin install climpt-agent
```

> **Note**: The agent will display a warning if the plugin is not installed but
> will continue to run with limited functionality.

### Verify Setup

```bash
gh auth status
git status
git remote -v
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

### Execute Initialization Command

```bash
cd your-project
deno run -A jsr:@aidevtool/climpt/agents/iterator --init
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

### Project-Based Execution

Execute until all items in the Project are complete:

```bash
deno run -A jsr:@aidevtool/climpt/agents/iterator --project 5
```

### Limit Iteration Count

Stop after maximum 10 iterations:

```bash
deno run -A jsr:@aidevtool/climpt/agents/iterator --iterate-max 10
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

### allowedTools Behavior

`allowedTools` is the **primary mechanism** for restricting which tools the
agent can use. Only tools listed here are available to Claude during execution.

**Important notes:**

- The SDK init message shows all registered tools (22+), but the `allowedTools`
  restriction is enforced at tool usage time, not at initialization
- Climpt agents apply additional step-kind-based filtering via
  `filterAllowedTools()` — boundary tools (e.g., `githubIssueClose`) are
  automatically removed during work/verification steps
- To structurally guarantee tool restrictions, always define `allowedTools`
  explicitly rather than relying solely on `permissionMode`

For SDK permission modes, see
[Configure permissions](../../reference/sdk/permissions.md#permission-modes).

### permissionMode Types

| Mode                | Description                              | Recommended Use                    |
| ------------------- | ---------------------------------------- | ---------------------------------- |
| `default`           | Confirmation required for all operations | Initial testing                    |
| `plan`              | Planning mode (no tool execution)        | Plan review                        |
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

### The `claude_code` Preset

The Agent SDK uses an **empty system prompt** by default. To use Claude Code's
full system prompt (tool instructions, code guidelines, safety rules, and
environment context), specify the `claude_code` preset in your agent
configuration:

```json
{
  "agents": {
    "climpt": {
      "systemPrompt": {
        "type": "preset",
        "preset": "claude_code",
        "append": "Custom instructions added after the preset prompt."
      }
    }
  }
}
```

**Key points:**

- The preset provides tool usage instructions, code guidelines, git protocols,
  and environment context — without it, the agent operates with minimal guidance
- The preset does **NOT** automatically load CLAUDE.md files — you must
  configure `settingSources: ["project"]` separately to load project-level
  instructions
- Use `append` to add custom instructions while preserving all built-in
  functionality

| Scenario                     | Configuration                    |
| :--------------------------- | :------------------------------- |
| Claude Code-like agent       | Use `claude_code` preset         |
| Custom behavior from scratch | Use custom `systemPrompt` string |
| Extend Claude Code behavior  | Use preset with `append`         |
| Minimal/embedded agent       | Omit preset (empty prompt)       |

For detailed documentation, see
[Modifying system prompts](../../reference/sdk/modifying-system-prompts.md#understanding-system-prompts).

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

A detailed report is displayed upon completion. Sample Performance table:

```
⏱️  Performance
  | Metric         | Value          | Source              |
  |----------------|----------------|---------------------|
  | Total Time     | 328s (~5.5min) | SDK `duration_ms`   |
  | API Time       | 241s (~4min)   | SDK internal        |
  | Turns          | 28             | SDK `num_turns`     |
  | Iterations     | 1              | Agent runner        |
  | Total Cost     | $0.82 USD      | SDK `total_cost_usd`|
```

The report also includes Token Usage, Activity, and Tools Used sections.

### Log Files

Logs are saved in JSONL format:

```
tmp/logs/agents/climpt/session-2025-12-31T10-00-00-000Z.jsonl
```

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

### gh command not found / gh auth status fails

GitHub CLI must be installed and authenticated:

```bash
brew install gh    # macOS
gh auth login
```

See [01-prerequisites.md](./01-prerequisites.md)

### Configuration file not found / Empty output from breakdown CLI

Run init from project root (re-run if prompt templates are missing):

```bash
cd your-project
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

### Project not found / Issue not found

Verify the target exists on GitHub:

```bash
gh project list --owner @me
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

## Related Documentation

- [Iterate Agent Detailed Reference](../../agents/iterator/README.md)

---

## Support

If you encounter issues, please create an Issue:
https://github.com/tettuan/climpt/issues
