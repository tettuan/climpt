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
<plugin-root>/.claude-plugin/skills/<skill-name>/SKILL.md
```

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
<plugin-root>/.claude-plugin/skills/{skill_name}/
```

### Step 5: Copy SKILL.md

Copy the skill file preserving:
- All frontmatter fields
- Complete markdown content
- Any associated files in the skill directory

### Step 6: Report Results

Report:
- Source path: `.claude/skills/{uv-skill_name}/SKILL.md`
- Destination path: `<plugin>/.claude-plugin/skills/{skill_name}/SKILL.md`
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
4. Create `<plugin>/.claude-plugin/skills/branch-management/`
5. Copy `SKILL.md` to target directory
6. Report success with paths

Output:
```
Converted skill 'branch-management'
  From: .claude/skills/branch-management/SKILL.md
  To: .claude-plugin/skills/branch-management/SKILL.md
```

## Error Handling

| Error | Description | Resolution |
|-------|-------------|------------|
| Skill not found | Source skill directory doesn't exist | Verify skill name and path |
| Invalid frontmatter | Missing required fields | Add missing name/description |
| No local plugin | No plugin found to convert to | Create a local plugin first |
| Permission denied | Cannot write to target location | Check file permissions |

## Notes

- The original skill in `.claude/skills/` is NOT deleted
- If the skill already exists in the target plugin, prompt for overwrite confirmation
- Preserve any additional files in the skill directory (images, examples, etc.)
