[English](../en/02-climpt-setup.md) | [日本語](../ja/02-climpt-setup.md)

# 2. Climpt Setup

Set up Climpt in your project using direct JSR execution.

## Contents

1. [Prerequisites](#21-prerequisites)
2. [Project Initialization](#22-project-initialization)
3. [Claude Code Plugin Installation](#23-claude-code-plugin-installation)
4. [Verification](#24-verification)

---

## 2.1 Prerequisites

- **Deno 2.5+**: Install from [deno.land](https://deno.land)
- **Internet connection**: Required for JSR package resolution

Verify Deno installation:
```bash
deno --version
```

---

## 2.2 Project Initialization

Initialize Climpt in your project directory.

### Navigate to Project Directory

```bash
cd your-project
```

### Execute Initialization Command

```bash
deno run -A jsr:@aidevtool/climpt init
```

Example output:
```
Climpt initialized successfully!
Created configuration files in .agent/climpt/
```

### Created File Structure

```
your-project/
├── .agent/
│   └── climpt/
│       ├── config/
│       │   ├── default-app.yml      # Application configuration
│       │   └── registry_config.json # Registry configuration
│       ├── prompts/                  # Prompt templates
│       │   └── (empty initially)
│       └── registry.json             # Command registry
└── ...
```

### Check Configuration Files

#### default-app.yml

```yaml
# .agent/climpt/config/default-app.yml
working_dir: ".agent/climpt"
app_prompt:
  base_dir: "prompts"
app_schema:
  base_dir: "schema"
```

#### registry_config.json

```json
{
  "registries": {
    "climpt": ".agent/climpt/registry.json"
  }
}
```

---

## 2.3 Claude Code Plugin Installation

Installing the Claude Code plugin is required to use Iterate Agent.

### Add Marketplace

Execute the following command in Claude Code:

```
/plugin marketplace add tettuan/climpt
```

### Install Plugin

```
/plugin install climpt-agent
```

**Note**: If `/plugin install` fails:

1. Open the plugin browser with `/plugin`
2. Select the "Discover" tab
3. Search for and install `climpt-agent`

### Verify Installation

When the plugin is successfully installed, the following Skill becomes available:

- `delegate-climpt-agent`: Delegate tasks to Climpt agent

Verification method:
```
/plugin list
```

Success if output contains `climpt-agent`.

---

## 2.4 Verification

### Check Climpt Command

```bash
# Display help
deno run -A jsr:@aidevtool/climpt --help

# Check version
deno run -A jsr:@aidevtool/climpt --version
```

### Check Project Configuration

```bash
# Verify configuration files exist
ls -la .agent/climpt/config/
```

### Check Plugin (In Claude Code)

```
/plugin list
```

---

## Troubleshooting

### Initialization Fails

Ensure you're running from the project root:

```bash
pwd
ls -la
```

### Plugin Installation Fails

1. Update Claude Code to the latest version
2. Manually install from plugin browser with `/plugin`

---

## Next Step

You have two paths:

### A. Using Existing Instructions

→ Proceed to [04-iterate-agent-setup.md](./04-iterate-agent-setup.md) to set up Iterate Agent

### B. Creating Custom Instructions

→ Proceed to [03-instruction-creation.md](./03-instruction-creation.md) to learn how to create instructions
