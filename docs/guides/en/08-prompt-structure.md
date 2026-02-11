[English](../en/08-prompt-structure.md) | [日本語](../ja/08-prompt-structure.md)

# 8. Prompt Structure

Explains prompt file structure, manual creation methods, and template variable
mechanisms.

## Contents

1. [Prompt File Basics](#81-prompt-file-basics)
2. [Writing Frontmatter](#82-writing-frontmatter)
3. [Template Variables](#83-template-variables)
4. [User Variables (uv)](#84-user-variables-uv)
5. [Manual Prompt Creation Steps](#85-manual-prompt-creation-steps)
6. [Edition and Adaptation](#86-edition-and-adaptation)

---

## 8.1 Prompt File Basics

### File Placement

```
.agent/climpt/prompts/{c1}/{c2}/{c3}/f_{edition}_{adaptation}.md
```

Examples:

```
.agent/climpt/prompts/git/decide-branch/working-branch/f_default.md
.agent/climpt/prompts/code/review/pull-request/f_detailed.md
.agent/climpt/prompts/meta/create/instruction/f_default_strict.md
```

### File Structure

Prompt files consist of two parts:

```markdown
---
# Frontmatter (YAML format metadata)
c1: git
c2: decide-branch
c3: working-branch
title: Decide Working Branch
description: Decide branch strategy based on task content
---

---

# Prompt Body (Markdown)

Write instructions for AI here.

Template variables can be used: {input_text} {destination_path}
```

### File Naming Convention

| Filename                      | Description       | Selection Condition         |
| ----------------------------- | ----------------- | --------------------------- |
| `f_default.md`                | Default           | When no options specified   |
| `f_{edition}.md`              | Edition specified | When `--edition={edition}`  |
| `f_{edition}_{adaptation}.md` | Both specified    | When both options specified |

---

## 8.2 Writing Frontmatter

### Required Fields

```yaml
---
c1: code                           # Domain
c2: analyze                        # Action
c3: complexity                     # Target
title: Analyze Code Complexity     # Title (English)
---
```

### Recommended Fields

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
    - detailed
  adaptation:
    - default
    - strict
  file: true
  stdin: true
  destination: true
---
```

### Field Descriptions

| Field                 | Type     | Required | Description                |
| --------------------- | -------- | -------- | -------------------------- |
| `c1`                  | string   | Yes      | Domain                     |
| `c2`                  | string   | Yes      | Action                     |
| `c3`                  | string   | Yes      | Target                     |
| `title`               | string   | Yes      | Title (English)            |
| `description`         | string   | No       | Description (English)      |
| `usage`               | string   | No       | Usage example              |
| `c3l_version`         | string   | No       | C3L version                |
| `options.edition`     | string[] | No       | Edition list               |
| `options.adaptation`  | string[] | No       | Processing mode list       |
| `options.file`        | boolean  | No       | File input support         |
| `options.stdin`       | boolean  | No       | STDIN support              |
| `options.destination` | boolean  | No       | Output destination support |
| `uv`                  | array    | No       | User variable definitions  |

### Important Rules

- **All values must be in English**
- Enclose `c3l_version` in quotes: `"0.5"`
- `c1`, `c2`, `c3` use lowercase and hyphens only

---

## 8.3 Template Variables

### Available Variables

| Variable             | CLI Option            | Description              |
| -------------------- | --------------------- | ------------------------ |
| `{input_text}`       | STDIN                 | Text from standard input |
| `{input_text_file}`  | `-f`, `--from`        | Input file path          |
| `{destination_path}` | `-o`, `--destination` | Output destination path  |
| `{uv-*}`             | `--uv-*`              | User-defined variables   |

### Usage Example

Prompt file:

```markdown
# Code Analysis

## Target File

{input_text_file}

## Input Content
```

{input_text}

```
## Output Destination
{destination_path}
```

CLI execution:

```bash
echo "function test() { return 1; }" | \
  climpt-code analyze complexity \
  -f=./src/main.ts \
  -o=./output/result.md
```

Output after replacement:

```markdown
# Code Analysis

## Target File

./src/main.ts

## Input Content
```

function test() { return 1; }

```
## Output Destination
./output/result.md
```

### Replacement Flow

```
┌─────────────────────────────────────────────────────────────┐
│                  Template Replacement Flow                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Prompt template:                                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ File: {input_text_file}                             │   │
│  │ Content: {input_text}                               │   │
│  │ Language: {uv-lang}                                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                │
│                            ▼                                │
│  CLI input:                                                 │
│  echo "code" | climpt-code analyze -f=main.ts --uv-lang=ts  │
│                            │                                │
│                            ▼                                │
│  After replacement:                                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ File: main.ts                                       │   │
│  │ Content: code                                       │   │
│  │ Language: ts                                        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 8.4 User Variables (uv)

### Declaration in Frontmatter

```yaml
---
c1: code
c2: convert
c3: source-file
title: Convert Source File
options:
  edition:
    - default
  file: true
  stdin: true
  destination: true
uv:
  - target_language: Target programming language for conversion
  - style_guide: Code style guide to follow (optional)
---
```

### Usage in Prompt Body

```markdown
# Code Conversion

Convert the input code to **{uv-target_language}**.

## Style Guide

{uv-style_guide}

## Input Code
```

{input_text}

```
```

### CLI Specification

```bash
echo "def hello(): print('Hello')" | \
  climpt-code convert source-file \
  --uv-target_language=typescript \
  --uv-style_guide=airbnb
```

### uv Field Format

```yaml
uv:
  - variable_name: Description of the variable
  - another_var: Another description
```

- Variable names use snake_case (`target_language`)
- Reference in prompts with `{uv-target_language}`
- Specify in CLI with `--uv-target_language=value`

---

## 8.5 Manual Prompt Creation Steps

How to create prompts manually without using `meta create instruction`.

### Step 1: Create Directory

```bash
mkdir -p .agent/climpt/prompts/code/analyze/complexity
```

### Step 2: Create Prompt File

```bash
touch .agent/climpt/prompts/code/analyze/complexity/f_default.md
```

### Step 3: Write Frontmatter

```markdown
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
  stdin: true
  destination: true
---
```

### Step 4: Write Prompt Body

```markdown
# Code Complexity Analysis

## Target

Please analyze the complexity of the following code.

### Input File

{input_text_file}

### Input Content
```

{input_text}

```
## Analysis Items

1. Cyclomatic complexity
2. Cognitive complexity
3. Nesting depth
4. Function line count

## Output Format

Output analysis results in the following format:

- Score for each function
- List of areas needing improvement
- Specific improvement suggestions

## Output Destination

{destination_path}
```

### Step 5: Check/Create Config File

Only for new domains:

```bash
cat > .agent/climpt/config/code-app.yml << 'EOF'
working_dir: ".agent/climpt"
app_prompt:
  base_dir: "prompts/code"
app_schema:
  base_dir: "schema/code"
EOF
```

### Step 6: Create Executable (For CLI Use)

```bash
cat > .deno/bin/climpt-code << 'EOF'
#!/bin/sh
case "$1" in
    -h|--help|-v|--version)
        exec deno run --allow-read --allow-write --allow-env --allow-run --allow-net --no-config 'jsr:@aidevtool/climpt' "$@"
        ;;
    *)
        exec deno run --allow-read --allow-write --allow-env --allow-run --allow-net --no-config 'jsr:@aidevtool/climpt' --config=code "$@"
        ;;
esac
EOF

chmod +x .deno/bin/climpt-code
```

### Step 7: Update Registry

```bash
deno task generate-registry
# or
deno run --allow-read --allow-write --allow-env jsr:@aidevtool/climpt/reg
```

### Step 8: Verify Operation

```bash
climpt-code analyze complexity --help

echo "function test() { if(a) { if(b) { } } }" | \
  climpt-code analyze complexity
```

---

## 8.6 Edition and Adaptation

### Concepts

| Concept    | Description             | Examples                                   |
| ---------- | ----------------------- | ------------------------------------------ |
| edition    | Input type/purpose      | `default`, `bug`, `feature`, `refactor`    |
| adaptation | Processing detail level | `default`, `detailed`, `strict`, `minimal` |

### File Selection Priority

```
When --edition=bug --adaptation=detailed:

1. f_bug_detailed.md  ← Highest priority
2. f_bug.md
3. f_default_detailed.md
4. f_default.md       ← Last fallback
```

### Usage Examples

```bash
# Default
climpt-code review pull-request

# Bug fix edition
climpt-code review pull-request --edition=bug

# Detailed processing mode
climpt-code review pull-request --adaptation=detailed

# Both specified
climpt-code review pull-request --edition=bug --adaptation=detailed
```

### Directory Structure Example

```
prompts/code/review/pull-request/
├── f_default.md           # Default
├── f_bug.md               # For bug fixes
├── f_feature.md           # For new features
├── f_default_detailed.md  # Detailed mode
├── f_bug_detailed.md      # Bug fix + detailed
└── f_feature_strict.md    # New feature + strict
```

---

## Checklist

Verification items after prompt creation:

- [ ] File exists in correct location
  ```bash
  ls .agent/climpt/prompts/{c1}/{c2}/{c3}/
  ```

- [ ] Frontmatter is in correct format
  ```bash
  head -20 .agent/climpt/prompts/{c1}/{c2}/{c3}/f_default.md
  ```

- [ ] All values are in English

- [ ] Registered in registry
  ```bash
  cat .agent/climpt/registry.json | jq '.tools.commands[] | select(.c2 == "{c2}")'
  ```

- [ ] Command can be executed
  ```bash
  climpt-{c1} {c2} {c3} --help
  ```

---

## Related Guides

- [03-instruction-creation.md](./03-instruction-creation.md) - Instruction
  creation via auto-generation
- [05-architecture.md](./05-architecture.md) - Architecture Overview
- [06-config-files.md](./06-config-files.md) - Config Files
- [07-dependencies.md](./07-dependencies.md) - Dependencies
