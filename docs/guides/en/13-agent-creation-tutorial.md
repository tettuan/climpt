[English](../en/13-agent-creation-tutorial.md) |
[日本語](../ja/13-agent-creation-tutorial.md)

# 13. Agent Creation Tutorial

This tutorial walks you through creating an Agent from scratch. By the end, you
will have a working agent that runs with `deno task agent`.

---

## 13.1 Prerequisites

**Concepts:** An **Agent** is a unit of autonomous task execution defined by
configuration (`agent.json`) and prompts. The **Agent Runner** is the shared
execution engine that runs all agents. A **Verdict** determines when the agent
stops. See [00-1-concepts.md](./00-1-concepts.md) for full details.

**Setup:** Climpt must be installed and initialized. See
[02-climpt-setup.md](./02-climpt-setup.md) if you have not done this yet.

---

## 13.2 Your First Agent: Step by Step

We will create the simplest possible agent -- one that runs a fixed number of
iterations using the `count:iteration` verdict type.

### Step 1: Create the Directory Structure

```bash
mkdir -p .agent/my-first-agent/prompts
```

Your project should now contain:

```
.agent/my-first-agent/
├── prompts/        (empty for now)
└── (agent.json)    (created in step 2)
```

### Step 2: Create agent.json

Create `.agent/my-first-agent/agent.json` with the following content:

```json
{
  "$schema": "../../agents/schemas/agent.schema.json",
  "name": "my-first-agent",
  "displayName": "My First Agent",
  "description": "A simple agent that runs a fixed number of iterations",
  "version": "1.13.0",
  "parameters": {},
  "runner": {
    "flow": {
      "systemPromptPath": "prompts/system.md"
    },
    "verdict": {
      "type": "count:iteration",
      "config": {
        "maxIterations": 3
      }
    },
    "boundaries": {
      "allowedTools": ["Read", "Glob", "Grep"],
      "permissionMode": "plan"
    },
    "logging": {
      "directory": "tmp/logs/agents/my-first-agent",
      "format": "jsonl"
    }
  }
}
```

**Field explanations:**

| Field                          | Purpose                                                      |
| ------------------------------ | ------------------------------------------------------------ |
| `$schema`                      | Enables IDE validation. Path is relative to `.agent/{name}/` |
| `name`                         | Agent identifier. Must be lowercase kebab-case               |
| `displayName`                  | Human-readable name shown in logs                            |
| `description`                  | What this agent does                                         |
| `version`                      | Schema version (semver)                                      |
| `parameters`                   | CLI parameters the agent accepts (empty here)                |
| `runner.flow.systemPromptPath` | Path to system prompt, relative to `.agent/{name}/`          |
| `runner.verdict.type`          | When to stop: after 3 iterations                             |
| `runner.boundaries`            | Tool restrictions and permission mode                        |
| `runner.logging`               | Where and how to write logs                                  |

For the full field reference, see
[11-runner-reference.md](./11-runner-reference.md).

### Step 3: Create the System Prompt

Create `.agent/my-first-agent/prompts/system.md`:

```markdown
# My First Agent

You are a simple agent. Your job is to explore the current project and summarize
what you find.

## Guidelines

- Read files to understand the project structure
- Report your findings clearly
- You have 3 iterations to complete your work
```

The directory structure is now:

```
.agent/my-first-agent/
├── agent.json
└── prompts/
    └── system.md
```

### Step 4: Validate the Configuration

```bash
deno task agent --agent my-first-agent --validate
```

Expected output on success:

```
Validating agent: my-first-agent
  ✓ agent.json -- Schema valid
  ✓ agent.json -- Configuration valid

Validation passed.
```

If validation fails, the output will show which fields have errors. Fix them
before proceeding.

### Step 5: Run the Agent

```bash
deno task agent --agent my-first-agent
```

Expected output:

```
Loading agent: my-first-agent
  My First Agent: A simple agent that runs a fixed number of iterations

Starting My First Agent...

...agent executes 3 iterations...

============================================================
Agent completed: SUCCESS
Total iterations: 3
Reason: Max iterations reached
============================================================
```

### Step 6: Check the Results

Log files are written to the directory specified in `runner.logging.directory`:

```bash
ls tmp/logs/agents/my-first-agent/
```

Each session produces a `.jsonl` file containing one JSON object per line. Each
line records a single event (iteration start, tool call, LLM response, etc.).

---

## 13.3 Adding Parameters

Parameters let users pass values from the CLI to the agent at runtime. Each
entry in the `parameters` object becomes a CLI flag.

To add a `--target` parameter, update the `parameters` field in `agent.json`:

```json
{
  "parameters": {
    "target": {
      "type": "string",
      "description": "Directory or file to analyze",
      "required": true,
      "cli": "--target"
    }
  }
}
```

**Required fields for each parameter:**

| Field         | Description                                       |
| ------------- | ------------------------------------------------- |
| `type`        | `"string"`, `"number"`, `"boolean"`, or `"array"` |
| `description` | Shown in help output                              |
| `cli`         | CLI flag name (must start with `--`, kebab-case)  |

**Optional fields:**

| Field      | Description                            |
| ---------- | -------------------------------------- |
| `required` | `true` if the flag must be provided    |
| `default`  | Default value when the flag is omitted |

Now run the agent with the parameter:

```bash
deno task agent --agent my-first-agent --target src/
```

The runner reads `definition.parameters`, maps each key to its CLI flag, and
passes matched values to the agent session as `runnerArgs`.

---

## 13.4 Leveling Up

Once you have a basic agent working, consider these enhancements.

### 13.4.1 Adding steps_registry.json

A steps registry defines multi-step flows with explicit transitions between
phases (initial, continuation, verification, closure). Without it, the agent
uses a single system prompt for every iteration. Add a `steps_registry.json` to
your agent directory and configure `runner.flow.prompts.registry` to point to
it.

### 13.4.2 Changing the Verdict Type

The `count:iteration` verdict is the simplest, but other types offer more
control. `detect:keyword` lets the LLM signal completion by outputting a
keyword. `detect:graph` enables DAG-based step transitions with a state machine.
See the verdict type selection flowchart in
[11-runner-reference.md, section 11.3.2](./11-runner-reference.md#113-runnerverdict).

### 13.4.3 Enabling GitHub Integration

Set `runner.integrations.github.enabled` to `true` and use `poll:state` as the
verdict type to create an agent that monitors a GitHub Issue and stops when the
issue is closed or labeled. See
[04-iterate-agent-setup.md](./04-iterate-agent-setup.md) for setup details.

### 13.4.4 Using Worktrees

Enable `runner.execution.worktree` to run the agent in an isolated git worktree.
This prevents the agent from polluting your main working tree during autonomous
operation. See
[11-runner-reference.md, section 11.7](./11-runner-reference.md#117-runnerexecution)
for configuration options.

---

## 13.5 Complete Minimal Agent Template

A copy-paste-ready template for a minimal working agent.

**Directory structure:**

```
.agent/my-agent/
├── agent.json
└── prompts/
    └── system.md
```

**`.agent/my-agent/agent.json`:**

```json
{
  "$schema": "../../agents/schemas/agent.schema.json",
  "name": "my-agent",
  "displayName": "My Agent",
  "description": "Describe what this agent does",
  "version": "1.13.0",
  "parameters": {
    "topic": {
      "type": "string",
      "description": "Topic for the session",
      "required": true,
      "cli": "--topic"
    }
  },
  "runner": {
    "flow": {
      "systemPromptPath": "prompts/system.md"
    },
    "verdict": {
      "type": "count:iteration",
      "config": {
        "maxIterations": 5
      }
    },
    "boundaries": {
      "allowedTools": ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      "permissionMode": "acceptEdits"
    },
    "logging": {
      "directory": "tmp/logs/agents/my-agent",
      "format": "jsonl"
    }
  }
}
```

**`.agent/my-agent/prompts/system.md`:**

```markdown
# My Agent

You are operating as the **my-agent** agent.

## Task

Work on the given topic thoroughly.

## Guidelines

- Think step by step
- Report progress at each iteration
- Use the available tools to read and modify files
```

**Validate and run:**

```bash
deno task agent --agent my-agent --validate
deno task agent --agent my-agent --topic "Your topic here"
```

**Alternative -- use `--init` to scaffold automatically:**

```bash
deno task agent --init --agent my-agent
```

This creates `agent.json`, `steps_registry.json`, system prompt, step prompts,
and breakdown configuration files. You can then edit the generated files to
match your needs.

---

## See Also

- [00-1-concepts.md](./00-1-concepts.md) -- Agent, Runner, and Verdict concepts
- [11-runner-reference.md](./11-runner-reference.md) -- Full `runner.*` field
  reference
- [04-iterate-agent-setup.md](./04-iterate-agent-setup.md) -- GitHub
  Issue-driven agent setup
- [05-architecture.md](./05-architecture.md) -- Runtime architecture overview
