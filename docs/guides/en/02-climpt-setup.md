[English](../en/02-climpt-setup.md) | [日本語](../ja/02-climpt-setup.md)

# 2. Climpt Setup

Install Climpt and configure it for use in your project.

## Contents

1. [Installing Climpt](#21-installing-climpt)
2. [Project Initialization](#22-project-initialization)
3. [Claude Code Plugin Installation](#23-claude-code-plugin-installation)
4. [Verification](#24-verification)

---

## 2.1 Installing Climpt

### Global Installation (Recommended)

```bash
deno install \
  --allow-read \
  --allow-write \
  --allow-net \
  --allow-env \
  --global \
  climpt \
  jsr:@aidevtool/climpt
```

Option explanations:
- `--allow-read`: Allow file reading (required for input files)
- `--allow-write`: Allow file writing (required for output generation)
- `--allow-net`: Allow network access (required for JSR package download)
- `--allow-env`: Allow environment variable access (required for configuration)
- `--global`: Install globally
- `climpt`: Command name

### Verify Installation

```bash
climpt --version
```

Example output:
```
climpt 1.9.18
```

### Display Help

```bash
climpt --help
```

---

## 2.2 Project Initialization

Initialize Climpt in the project where you want to use it.

### Navigate to Project Directory

```bash
cd your-project
```

### Execute Initialization Command

```bash
climpt init
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
climpt --help

# Check version
climpt --version
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

### climpt: command not found

Deno's bin directory may not be in PATH:

```bash
# Check PATH
echo $PATH | tr ':' '\n' | grep deno

# Add to PATH
export PATH="$HOME/.deno/bin:$PATH"
```

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
