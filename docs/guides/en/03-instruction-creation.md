[English](../en/03-instruction-creation.md) |
[日本語](../ja/03-instruction-creation.md)

# 3. Creating Instructions (Prompts)

This explains how to create instruction files (prompt files) used with Climpt.

## 3.1 What are Instructions

Instructions are markdown files that define directives for AI. They follow the
C3L (Climpt 3-word Language) path convention (see
[00-1-concepts.md](./00-1-concepts.md) for details).

Command format: `climpt-<c1> <c2> <c3> [options]`

Examples:

```bash
climpt-git decide-branch working-branch
climpt-meta create instruction
climpt-code review pull-request
```

---

## 3.2 Creation Flow

1. **`meta create instruction`** -- Enter purpose, domain, action, target to
   generate a prompt file template
2. **`meta build frontmatter`** -- Generate C3L v0.5 compliant frontmatter and
   insert at file beginning
3. **Registry Update (`/reg`)** -- Regenerate registry.json so the command
   becomes available via MCP/CLI

---

## 3.3 Step 1: Create Instruction with meta create instruction

### Command Execution

```bash
climpt-meta create instruction << 'EOF'
Purpose: Analyze code complexity
Domain: code
Action: analyze
Target: complexity
Description: Calculate cyclomatic complexity and provide improvement suggestions
EOF
```

### Skill Invocation in Claude Code

You can also request in natural language within Claude Code:

```
Create a new Climpt instruction.
- Purpose: Code complexity analysis
- Domain: code
- Action: analyze
- Target: complexity

Please use meta create instruction.
```

### Generated Content

This command generates:

1. Directory structure: `.agent/climpt/prompts/code/analyze/complexity/`
2. Prompt file: `.agent/climpt/prompts/code/analyze/complexity/f_default.md`
3. Config files (if needed): `.agent/climpt/config/code-app.yml`,
   `code-user.yml`
4. Executable file (if needed): `.deno/bin/climpt-code`

---

## 3.4 Step 2: Generate Frontmatter with meta build frontmatter

Generate C3L v0.5 compliant frontmatter for the created prompt file.

```bash
echo "Domain: code
Action: analyze
Target: complexity
Purpose: Calculate cyclomatic complexity and provide improvement suggestions" | climpt-meta build frontmatter
```

### Generated Frontmatter

```yaml
---
c1: code
c2: analyze
c3: complexity
title: Analyze Code Complexity
description: Calculate cyclomatic complexity and provide improvement suggestions
usage: climpt-code analyze complexity
c3l_version: "0.5"
options:
  edition:
    - default
  adaptation:
    - default
    - detailed
  file: true
  stdin: false
  destination: false
---
```

### Important Rules

- **All frontmatter values must be in English**
- Enclose `c3l_version` in quotes: `"0.5"`
- `title` and `description` must be in English

Insert the generated frontmatter at the beginning of the prompt file.

---

## 3.5 Step 3: Update Registry

After creating/updating prompt files, regenerate the registry.

### Execute in Claude Code (Recommended)

```
/reg
```

Or via CLI:

```bash
deno task generate-registry
# Or: deno run --allow-read --allow-write --allow-env jsr:@aidevtool/climpt/reg
```

Verify the new command is registered:

```bash
cat .agent/climpt/registry.json | jq '.tools.commands[] | select(.c1 == "code")'
```

---

## 3.6 Instruction Structure

### File Placement

```
.agent/climpt/prompts/<domain>/<action>/<target>/
├── f_default.md           # Default version
├── f_detailed.md          # Detailed version (optional)
└── f_<edition>.md         # Other variations
```

### File Naming Convention

| Filename                      | Description      | Usage Condition                      |
| ----------------------------- | ---------------- | ------------------------------------ |
| `f_default.md`                | Default          | When `--edition` not specified       |
| `f_<edition>.md`              | Specific edition | When `--edition=<edition>` specified |
| `f_<edition>_<adaptation>.md` | Combination      | When both specified                  |

### Template Variables

Variables available in prompts:

| Variable             | CLI Option                | Description              |
| -------------------- | ------------------------- | ------------------------ |
| `{input_text}`       | STDIN                     | Text from standard input |
| `{input_text_file}`  | `--from` (or `-f`)        | Input file path          |
| `{destination_path}` | `--destination` (or `-o`) | Output destination path  |
| `{uv-*}`             | `--uv-*`                  | Custom variables         |

---

## 3.7 Practical Example

Create a git branch decision command:

```bash
# Step 1: Create instruction
climpt-meta create instruction << 'EOF'
Purpose: Determine branch strategy based on task content
Domain: git
Action: decide-branch
Target: working-branch
Description: Decide whether to create new branch or continue on current branch
EOF

# Step 2: Generate frontmatter
climpt-meta build frontmatter << 'EOF'
Domain: git
Action: decide-branch
Target: working-branch
Purpose: Decide branch strategy based on task content
EOF

# Step 3: Update registry
deno task generate-registry
```
