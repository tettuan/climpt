---
c1: meta
c2: convert-skill
c3: to-plugin
title: Convert Project Skill to Plugin
description: Convert a project-settings skill from .claude/skills/ to a local plugin's skill structure for cross-project reuse
usage: climpt-meta convert-skill to-plugin --uv-skill_name=<name>
c3l_version: "0.5"
options:
  edition:
    - default
  adaptation:
    - default
  file: false
  stdin: true
  destination: true
uv:
  - skill_name: Name of skill directory in .claude/skills/ to convert
---

# Convert Project Skill to Plugin

## Purpose

Convert a project-settings skill (`.claude/skills/<name>/SKILL.md`) to a local plugin's skill structure.

This is needed because:
- Skills in `.claude/skills/` are project-scoped only
- Local plugins can be shared across projects
- Converting allows skill reuse and distribution

## Input

- **uv-skill_name** (required): The skill directory name to convert
- **stdin** (optional): Additional context or instructions

### Usage Example

```bash
climpt-meta convert-skill to-plugin --uv-skill_name=branch-management
```

## Received Input

Skill name: {uv-skill_name}

Additional context:
{input_text}

## Claude Code Official Skill Specification

Based on official Claude Code documentation:

### Skill Frontmatter (SKILL.md)

Supported fields:
- `name`: skill-name (Required)
- `description`: What this skill does (Required)
- `allowed-tools`: [Tool1, Tool2] (Optional - restricts tool access)
- `model`: claude-sonnet-4-20250514 (Optional - override model)

NO on/off toggle mechanism exists for individual skills. Skills are either:
- **Available**: File exists in correct location
- **Unavailable**: File deleted

Plugins CAN be toggled via `enabledPlugins` in settings.json, but individual skills within plugins cannot.

### Plugin Skill Location

Local plugin skills are stored at:
```
<plugin-root>/skills/<skill-name>/SKILL.md
```

Note: Only `plugin.json` goes inside `.claude-plugin/`. All other directories (skills, commands, agents, hooks) must be at the plugin root.

## Conversion Process

### Step 1: Read Source Skill

Read the source skill file from:
```
.claude/skills/{uv-skill_name}/SKILL.md
```

### Step 2: Validate Frontmatter

Ensure the skill has required frontmatter fields:
- `name`: The skill name
- `description`: What this skill does

If validation fails, report what's missing and stop.

### Step 3: Determine Target Plugin

Check for local plugins in this order:

1. Check `.claude/plugins.json` for local plugin paths
2. Look for `.claude-plugin/` directory in project root
3. If no local plugin exists, prompt user to specify or create one

### Step 4: Create Target Directory

Create the target directory structure:
```
<plugin-root>/skills/{skill_name}/
```

### Step 5: Copy SKILL.md

Copy the skill file preserving:
- All frontmatter fields
- Complete markdown content
- Any associated files in the skill directory

### Step 6: Report Results

Report:
- Source path: `.claude/skills/{uv-skill_name}/SKILL.md`
- Destination path: `<plugin>/skills/{skill_name}/SKILL.md`
- Conversion status: success/failure
- Any warnings or modifications made

## Example

Input:
```bash
climpt-meta convert-skill to-plugin --uv-skill_name=branch-management
```

Process:
1. Read `.claude/skills/branch-management/SKILL.md`
2. Validate frontmatter has `name` and `description`
3. Determine target plugin location
4. Create `<plugin>/skills/branch-management/`
5. Copy `SKILL.md` to target directory
6. Report success with paths

Output:
```
Converted skill 'branch-management'
  From: .claude/skills/branch-management/SKILL.md
  To: <plugin>/skills/branch-management/SKILL.md
```

## Error Handling

| Error | Description | Resolution |
|-------|-------------|------------|
| Skill not found | Source skill directory doesn't exist | Verify skill name and path |
| Invalid frontmatter | Missing required fields | Add missing name/description |
| No local plugin | No plugin found to convert to | Create a local plugin first |
| Permission denied | Cannot write to target location | Check file permissions |

## Local Plugin Registration

If no local plugin exists, create one with the following steps:

### Step 1: Create Plugin Directory Structure

```
my-plugin/
├── .claude-plugin/
│   └── plugin.json          # Required: Plugin manifest (ONLY file in .claude-plugin/)
├── skills/                  # Skills directory at plugin root
│   └── <skill-name>/
│       └── SKILL.md         # Converted skill file
├── commands/                # (optional) Commands at plugin root
├── agents/                  # (optional) Agents at plugin root
└── hooks/                   # (optional) Hooks at plugin root
```

### Step 2: Create plugin.json

```json
{
  "name": "my-local-plugin",
  "version": "1.0.0",
  "description": "Local plugin for project-specific skills",
  "author": {
    "name": "Your Name"
  }
}
```

### Step 3: Register in Claude Code Settings

Register the local plugin via Claude Code CLI:

```bash
# Project scope (recommended)
/plugin install /path/to/my-plugin --scope project

# User scope (available across all projects)
/plugin install /path/to/my-plugin --scope user
```

After installation, the plugin appears in `.claude/settings.json`:

```json
{
  "permissions": {},
  "enabledPlugins": {
    "my-local-plugin@marketplace-name": true
  }
}
```

Note: The `enabledPlugins` format uses `plugin-name@marketplace-name`. For local plugins, use the `/plugin install` command rather than manual settings.json edits.

### Step 4: Verify Registration

After registration, the plugin's skills should appear in Claude Code's available skills.

```bash
# Check settings
cat .claude/settings.json | jq '.enabledPlugins'
```

### Plugin Scope Reference

| Scope | Location | Use Case |
|-------|----------|----------|
| `project` | `.claude/settings.json` | Project-specific plugins |
| `user` | `~/.claude/settings.json` | Personal plugins across projects |

## Notes

- The original skill in `.claude/skills/` is NOT deleted
- If the skill already exists in the target plugin, prompt for overwrite confirmation
- Preserve any additional files in the skill directory (images, examples, etc.)
