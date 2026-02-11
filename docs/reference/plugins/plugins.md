# Plugins - Claude Code Docs

Extend Claude Code with custom commands, agents, hooks, Skills, and MCP servers
through the plugin system.

## Quickstart

Let's create a simple greeting plugin to get you familiar with the plugin
system. We'll build a working plugin that adds a custom command, test it
locally, and understand the core concepts.

### Prerequisites

- Claude Code installed on your machine
- Basic familiarity with command-line tools

### Create your first plugin

#### 1. Create the marketplace structure

```bash
mkdir test-marketplace
cd test-marketplace
```

#### 2. Create the plugin directory

```bash
mkdir my-first-plugin
cd my-first-plugin
```

#### 3. Create the plugin manifest

Create `.claude-plugin/plugin.json`:

```json
{
  "name": "my-first-plugin",
  "description": "A simple greeting plugin to learn the basics",
  "version": "1.0.0",
  "author": {
    "name": "Your Name"
  }
}
```

#### 4. Add a custom command

Create `commands/hello.md`:

```markdown
---
description: Greet the user with a personalized message
---

# Hello Command

Greet the user warmly and ask how you can help them today. Make the greeting
personal and encouraging.
```

#### 5. Create the marketplace manifest

Create `marketplace.json`:

```json
{
  "name": "test-marketplace",
  "owner": {
    "name": "Test User"
  },
  "plugins": [
    {
      "name": "my-first-plugin",
      "source": "./my-first-plugin",
      "description": "My first test plugin"
    }
  ]
}
```

#### 6. Install and test your plugin

Start Claude Code from parent directory:

```bash
cd ..
claude
```

Add the test marketplace:

```bash
/plugin marketplace add ./test-marketplace
```

Install your plugin:

```bash
/plugin install my-first-plugin@test-marketplace
```

Select "Install now". You'll then need to restart Claude Code to use the new
plugin.

Try your new command:

```bash
/hello
```

You'll see Claude use your greeting command! Check `/help` to see your new
command listed.

### Plugin structure overview

Your plugin follows this basic structure:

```
my-first-plugin/
├── .claude-plugin/
│   └── plugin.json          # Plugin metadata
├── commands/                 # Custom slash commands (optional)
│   └── hello.md
├── agents/                   # Custom agents (optional)
│   └── helper.md
├── skills/                   # Agent Skills (optional)
│   └── my-skill/
│       └── SKILL.md
└── hooks/                    # Event handlers (optional)
    └── hooks.json
```

**Additional components you can add:**

- **Commands**: Create markdown files in `commands/` directory
- **Agents**: Create agent definitions in `agents/` directory
- **Skills**: Create `SKILL.md` files in `skills/` directory
- **Hooks**: Create `hooks/hooks.json` for event handling
- **MCP servers**: Create `.mcp.json` for external tool integration

---

## Install and manage plugins

Learn how to discover, install, and manage plugins to extend your Claude Code
capabilities.

### Prerequisites

- Claude Code installed and running
- Basic familiarity with command-line interfaces

### Add marketplaces

Marketplaces are catalogs of available plugins. Add them to discover and install
plugins:

```bash
/plugin marketplace add your-org/claude-plugins
```

Browse available plugins:

```bash
/plugin
```

### Install plugins

#### Via interactive menu (recommended for discovery)

Open the plugin management interface:

```bash
/plugin
```

Select "Browse Plugins" to see available options with descriptions, features,
and installation options.

#### Via direct commands (for quick installation)

Install a specific plugin:

```bash
/plugin install formatter@your-org
```

Enable a disabled plugin:

```bash
/plugin enable plugin-name@marketplace-name
```

Disable without uninstalling:

```bash
/plugin disable plugin-name@marketplace-name
```

Completely remove a plugin:

```bash
/plugin uninstall plugin-name@marketplace-name
```

### Installation scopes

Plugins can be installed at different scopes to control their availability and
sharing:

| Scope     | Location                      | Behavior                                |
| --------- | ----------------------------- | --------------------------------------- |
| `user`    | `~/.claude/settings.json`     | Available across all projects (default) |
| `project` | `.claude/settings.json`       | Shared with team via version control    |
| `local`   | `.claude/settings.local.json` | Project-specific, gitignored            |

**When to use each scope:**

- **User scope** (default): For plugins you want available in all your projects
- **Project scope**: For plugins your team should share (committed to git)
- **Local scope**: For personal plugins in a specific project (not shared)

Install to user scope (default):

```bash
claude plugin install formatter@your-org
```

Install to project scope (shared with team):

```bash
claude plugin install formatter@your-org --scope project
```

Install to local scope (gitignored):

```bash
claude plugin install formatter@your-org --scope local
```

The `--scope` option also works with `uninstall`, `enable`, and `disable`
commands:

Uninstall from project scope:

```bash
claude plugin uninstall formatter@your-org --scope project
```

### Verify installation

After installing a plugin:

1. **Check available commands**: Run `/help` to see new commands
2. **Test plugin features**: Try the plugin's commands and features
3. **Review plugin details**: Use `/plugin` → "Manage Plugins" to see what the
   plugin provides

### Set up team plugin workflows

Configure plugins at the repository level to ensure consistent tooling across
your team. When team members trust your repository folder, Claude Code
automatically installs specified marketplaces and plugins.

**To set up team plugins:**

1. Add marketplace and plugin configuration to your repository's
   `.claude/settings.json`
2. Team members trust the repository folder
3. Plugins install automatically for all team members

---

## Develop more complex plugins

Once you're comfortable with basic plugins, you can create more sophisticated
extensions.

### Add Skills to your plugin

Plugins can include Agent Skills to extend Claude's capabilities. Skills are
model-invoked—Claude autonomously uses them based on the task context. To add
Skills to your plugin, create a `skills/` directory at your plugin root and add
Skill folders with `SKILL.md` files. Plugin Skills are automatically available
when the plugin is installed.

See the [Skills documentation](../skills/overview.md) for more details.

### Test your plugins locally

When developing plugins, use a local marketplace to test changes iteratively.

#### 1. Set up your development structure

Organize your plugin and marketplace for testing:

```bash
mkdir dev-marketplace
cd dev-marketplace
mkdir my-plugin
```

This creates:

```
dev-marketplace/
├── .claude-plugin/marketplace.json  (you'll create this)
└── my-plugin/                        (your plugin under development)
    ├── .claude-plugin/plugin.json
    ├── commands/
    ├── agents/
    └── hooks/
```

#### 2. Create the marketplace manifest

Create `marketplace.json`:

```json
{
  "name": "dev-marketplace",
  "owner": {
    "name": "Developer"
  },
  "plugins": [
    {
      "name": "my-plugin",
      "source": "./my-plugin",
      "description": "Plugin under development"
    }
  ]
}
```

#### 3. Install and test

Start Claude Code from parent directory:

```bash
cd ..
claude
```

Add your development marketplace:

```bash
/plugin marketplace add ./dev-marketplace
```

Install your plugin:

```bash
/plugin install my-plugin@dev-marketplace
```

Test your plugin components:

- Try your commands with `/command-name`
- Check that agents appear in `/agents`
- Verify hooks work as expected

#### 4. Iterate on your plugin

After making changes to your plugin code:

Uninstall the current version:

```bash
/plugin uninstall my-plugin@dev-marketplace
```

Reinstall to test changes:

```bash
/plugin install my-plugin@dev-marketplace
```

Repeat this cycle as you develop and refine your plugin.

### Debug plugin issues

If your plugin isn't working as expected:

1. **Check the structure**: Ensure your directories are at the plugin root, not
   inside `.claude-plugin/`
2. **Test components individually**: Check each command, agent, and hook
   separately
3. **Use validation and debugging tools**: See the
   [plugins reference](plugins-reference.md) for CLI commands and
   troubleshooting techniques

### Share your plugins

When your plugin is ready to share:

1. **Add documentation**: Include a README.md with installation and usage
   instructions
2. **Version your plugin**: Use semantic versioning in your `plugin.json`
3. **Create or use a marketplace**: Distribute through plugin marketplaces for
   installation
4. **Test with others**: Have team members test the plugin before wider
   distribution

---

## Next steps

Now that you understand Claude Code's plugin system, here are suggested paths
for different goals:

### For plugin users

- **Discover plugins**: Browse community marketplaces for useful tools
- **Team adoption**: Set up repository-level plugins for your projects
- **Marketplace management**: Learn to manage multiple plugin sources
- **Advanced usage**: Explore plugin combinations and workflows

### For plugin developers

- **Advanced components**: Dive deeper into specific plugin components:
  - [Skills documentation](../skills/overview.md) - Extend Claude's capabilities
- **Distribution strategies**: Package and share your plugins effectively
- **Community contribution**: Consider contributing to community plugin
  collections

### For team leads and administrators

- **Repository configuration**: Set up automatic plugin installation for team
  projects
- **Plugin governance**: Establish guidelines for plugin approval and security
  review
- **Marketplace maintenance**: Create and maintain organization-specific plugin
  catalogs
- **Training and documentation**: Help team members adopt plugin workflows
  effectively

## See also

- [Plugins reference](plugins-reference.md) - Complete technical reference for
  plugin development
- [Skills documentation](../skills/overview.md) - Extend Claude's capabilities
