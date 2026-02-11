[English](../en/02-climpt-setup.md) | [日本語](../ja/02-climpt-setup.md)

# 2. Climpt Setup

Set up Climpt in your project using direct JSR execution.

## 2.1 Prerequisites

- **Deno 2.5+**: Install from [deno.land](https://deno.land)
- **Internet connection**: Required for JSR package resolution

---

## 2.2 Project Initialization

Navigate to your project directory and run:

```bash
deno run -A jsr:@aidevtool/climpt init
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

```
/plugin list
```

Success if output contains `climpt-agent`. The `delegate-climpt-agent` Skill
becomes available.

---

## 2.4 Verification

```bash
# Display help
deno run -A jsr:@aidevtool/climpt --help

# Check version
deno run -A jsr:@aidevtool/climpt --version

# Verify configuration files exist
ls -la .agent/climpt/config/
```

In Claude Code: `/plugin list`

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
