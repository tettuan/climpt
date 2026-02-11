[English](../en/03-instruction-creation.md) |
[日本語](../ja/03-instruction-creation.md)

# 3. Creating Instructions (Prompts)

This explains how to create instruction files (prompt files) used with Climpt.

## Contents

1. [What are Instructions](#31-what-are-instructions)
2. [Creation Flow](#32-creation-flow)
3. [Step 1: Create Instruction with meta create instruction](#33-step-1-create-instruction-with-meta-create-instruction)
4. [Step 2: Generate Frontmatter with meta build frontmatter](#34-step-2-generate-frontmatter-with-meta-build-frontmatter)
5. [Step 3: Update Registry](#35-step-3-update-registry)
6. [Instruction Structure](#36-instruction-structure)
7. [Practical Examples](#37-practical-examples)

---

## 3.1 What are Instructions

Instructions are markdown files that define directives for AI. Following the C3L
(Climpt 3-word Language) specification, they consist of three elements:

| Element     | Role              | Examples                                |
| ----------- | ----------------- | --------------------------------------- |
| c1 (Domain) | Target area       | `git`, `code`, `meta`, `test`           |
| c2 (Action) | Action to execute | `create`, `analyze`, `review`           |
| c3 (Target) | Target object     | `branch`, `pull-request`, `instruction` |

Command format:

```bash
climpt-<c1> <c2> <c3> [options]
```

Examples:

```bash
climpt-git decide-branch working-branch
climpt-meta create instruction
climpt-code review pull-request
```

---

## 3.2 Creation Flow

```
┌─────────────────────────────────────────────────────────────┐
│                 Instruction Creation Flow                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Step 1: meta create instruction                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Enter purpose, domain, action, target               │   │
│  │ → Generate prompt file template                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                         ↓                                   │
│  Step 2: meta build frontmatter                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Generate C3L v0.5 compliant frontmatter             │   │
│  │ → Insert in YAML format at file beginning           │   │
│  └─────────────────────────────────────────────────────┘   │
│                         ↓                                   │
│  Step 3: Registry Update (/reg)                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Regenerate registry.json from prompts               │   │
│  │ → Command becomes available via MCP/CLI             │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 3.3 Step 1: Create Instruction with meta create instruction

### Command Execution

Execute the following in Claude Code or invoke the Skill:

```bash
# Pass information via stdin
echo "Purpose: Analyze code complexity
Domain: code
Action: analyze
Target: complexity
Description: Calculate cyclomatic complexity and provide improvement suggestions" | climpt-meta create instruction
```

Or use heredoc:

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

1. Directory structure:
   ```
   .agent/climpt/prompts/code/analyze/complexity/
   ```

2. Prompt file:
   ```
   .agent/climpt/prompts/code/analyze/complexity/f_default.md
   ```

3. Config files (if needed):
   ```
   .agent/climpt/config/code-app.yml
   .agent/climpt/config/code-user.yml
   ```

4. Executable file (if needed):
   ```
   .deno/bin/climpt-code
   ```

---

## 3.4 Step 2: Generate Frontmatter with meta build frontmatter

Generate C3L v0.5 compliant frontmatter for the created prompt file.

### Command Execution

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

### Inserting Frontmatter

Insert the generated frontmatter at the beginning of the prompt file:

```bash
# Edit prompt file
vim .agent/climpt/prompts/code/analyze/complexity/f_default.md
```

---

## 3.5 Step 3: Update Registry

After creating/updating prompt files, regenerate the registry.

### Execute in Claude Code (Recommended)

```
/reg
```

Or:

```bash
deno task generate-registry
```

### Execute via JSR

```bash
deno run --allow-read --allow-write --allow-env jsr:@aidevtool/climpt/reg
```

### Execution Result

```
Registry generated successfully!
Updated: .agent/climpt/registry.json
Commands: 12 registered
```

### Verify registry.json

```bash
cat .agent/climpt/registry.json | jq '.tools.commands[] | select(.c1 == "code")'
```

Success if the new command is registered.

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

| Variable             | CLI Option            | Description              |
| -------------------- | --------------------- | ------------------------ |
| `{input_text}`       | STDIN                 | Text from standard input |
| `{input_text_file}`  | `-f`, `--from`        | Input file path          |
| `{destination_path}` | `-o`, `--destination` | Output destination path  |
| `{uv-*}`             | `--uv-*`              | Custom variables         |

### Example: Using Template Variables

```markdown
# Code Complexity Analysis

## Target File

{input_text_file}

## Analysis Content

{input_text}

## Output Destination

Save results to `{destination_path}`.

## Options

Maximum lines: {uv-max-lines}
```

---

## 3.7 Practical Examples

### Example 1: Creating Git Branch Decision Command

```bash
# Step 1: Create instruction
climpt-meta create instruction << 'EOF'
Purpose: Determine branch strategy based on task content
Domain: git
Action: decide-branch
Target: working-branch
Description: Decide whether to create new branch or continue on current branch
EOF

# Step 2: Generate frontmatter (if needed)
climpt-meta build frontmatter << 'EOF'
Domain: git
Action: decide-branch
Target: working-branch
Purpose: Decide branch strategy based on task content
EOF

# Step 3: Update registry
deno task generate-registry
```

### Example 2: Creating Code Review Command

```bash
# Step 1: Create instruction
climpt-meta create instruction << 'EOF'
Purpose: Execute pull request code review
Domain: code
Action: review
Target: pull-request
Description: Analyze code quality, bugs, and improvements to provide feedback
EOF

# Step 2 & 3: Generate frontmatter + Update registry
climpt-meta build frontmatter << 'EOF'
Domain: code
Action: review
Target: pull-request
Purpose: Review pull request code and provide feedback
EOF

deno task generate-registry
```

---

## Verification Checklist

After creating instructions, verify the following:

- [ ] Prompt file exists in correct location
  ```bash
  ls -la .agent/climpt/prompts/<domain>/<action>/<target>/
  ```

- [ ] Frontmatter is in correct format
  ```bash
  head -30 .agent/climpt/prompts/<domain>/<action>/<target>/f_default.md
  ```

- [ ] Registered in registry
  ```bash
  cat .agent/climpt/registry.json | jq '.tools.commands[] | select(.c2 == "<action>")'
  ```

- [ ] Command can be executed
  ```bash
  climpt-<domain> <action> <target> --help
  ```

---

## Next Step

Proceed to [04-iterate-agent-setup.md](./04-iterate-agent-setup.md) to set up
Iterate Agent.
