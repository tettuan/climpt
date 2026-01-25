[English](../en/06-config-files.md) | [日本語](../ja/06-config-files.md)

# 6. Config Files

Explains Climpt's directory structure and configuration file details.

## When to Customize Each File

Before diving into details, understand **when** you need to modify each file:

| File | Customize When... | Leave Default When... |
|------|-------------------|----------------------|
| `app.yml` | Prompts are in a non-standard location; sharing prompts across projects | Using standard `.agent/` structure |
| `user.yml` | Enforcing naming conventions; restricting command options; per-user output paths | No validation or path customization needed |
| `registry_config.json` | Managing multiple agents; sharing agents across projects | Single agent in standard location |

### Common Scenarios

**Scenario 1: Team sharing prompts**
→ Customize `app.yml` to point to shared directory

**Scenario 2: Enforce branch naming**
→ Add validation pattern in `user.yml`

**Scenario 3: Multiple agents (iterator + reviewer)**
→ Add entries to `registry_config.json`

**Scenario 4: First-time setup**
→ Use defaults, customize later as needed

## Contents

1. [Directory Structure](#61-directory-structure)
2. [app.yml (Application Configuration)](#62-appyml-application-configuration)
3. [user.yml (User Configuration)](#63-useryml-user-configuration)
4. [registry_config.json (Registry Configuration)](#64-registry_configjson-registry-configuration)
5. [Configuration Priority](#65-configuration-priority)

---

## 6.1 Directory Structure

### Overall Structure

```
your-project/
├── .agent/
│   └── climpt/
│       ├── config/                    # Config files
│       │   ├── registry_config.json   # Registry configuration
│       │   ├── default-app.yml        # Default configuration
│       │   ├── default-user.yml       # User configuration (optional)
│       │   ├── git-app.yml            # git domain configuration
│       │   ├── git-user.yml           # git user configuration
│       │   ├── code-app.yml           # code domain configuration
│       │   └── ...
│       │
│       ├── prompts/                   # Prompt templates
│       │   ├── git/                   # git domain
│       │   │   ├── decide-branch/     # c2: decide-branch
│       │   │   │   └── working-branch/# c3: working-branch
│       │   │   │       └── f_default.md
│       │   │   └── ...
│       │   │
│       │   ├── meta/                  # meta domain
│       │   │   └── ...
│       │   │
│       │   └── code/                  # code domain
│       │       └── ...
│       │
│       ├── schema/                    # Schema definitions (optional)
│       │   └── ...
│       │
│       └── registry.json              # Command registry
│
├── .deno/
│   └── bin/                           # Executables (for CLI use)
│       ├── climpt                     # Main command
│       ├── climpt-git                 # git domain
│       ├── climpt-meta                # meta domain
│       └── climpt-code                # code domain
│
└── agents/                            # Agents (optional)
    ├── iterator/                      # Iterate Agent
    │   └── config.json
    └── reviewer/                      # Review Agent
        └── config.json
```

### Directory Roles

| Directory | Role | Required |
|-----------|------|----------|
| `.agent/climpt/config/` | Config file storage | Yes |
| `.agent/climpt/prompts/` | Prompt templates | Yes |
| `.agent/climpt/schema/` | JSON Schema definitions | No |
| `.deno/bin/` | CLI executables | Not needed for MCP only |

### Prompt Directory Structure

```
prompts/{c1}/{c2}/{c3}/f_{edition}_{adaptation}.md
         │     │    │        │          │
         │     │    │        │          └─ Processing mode (optional)
         │     │    │        └─ Edition (default if omitted)
         │     │    └─ Target (object)
         │     └─ Action (verb)
         └─ Domain (area)
```

---

## 6.2 app.yml (Application Configuration)

Defines prompt and schema placement directories for each domain.

### Filename Convention

```
.agent/climpt/config/{domain}-app.yml
```

Examples:
- `git-app.yml` → For `climpt-git` command
- `code-app.yml` → For `climpt-code` command
- `default-app.yml` → Default (when `--config` not specified)

### Configuration Items

```yaml
# .agent/climpt/config/git-app.yml

# Working directory (base for prompt search)
working_dir: ".agent/climpt"

# Prompt file location
app_prompt:
  base_dir: "prompts/git"    # Relative path from working_dir

# Schema file location (optional)
app_schema:
  base_dir: "schema/git"
```

### Configuration Item Descriptions

| Item | Description | Required |
|------|-------------|----------|
| `working_dir` | Base directory for prompt search | Yes |
| `app_prompt.base_dir` | Base directory for prompt files | Yes |
| `app_schema.base_dir` | Base directory for schema files | No |

### Path Resolution Mechanism

How the command resolves to prompt file path:

```
Command: climpt-git decide-branch working-branch

1. working_dir: ".agent/climpt"
2. app_prompt.base_dir: "prompts/git"
3. c2: "decide-branch"
4. c3: "working-branch"
5. filename: "f_default.md"

Result: .agent/climpt/prompts/git/decide-branch/working-branch/f_default.md
```

---

## 6.3 user.yml (User Configuration)

Customize option default values and behavior.

### Filename Convention

```
.agent/climpt/config/{domain}-user.yml
```

### Configuration Items

```yaml
# .agent/climpt/config/git-user.yml

# Output destination prefix setting
options:
  destination:
    prefix: "output/git"    # Prepended to paths specified with -o

# Parameter validation patterns (optional)
params:
  two:
    directiveType:
      pattern: "^(decide-branch|group-commit|merge-up)$"
    layerType:
      pattern: "^(working-branch|unstaged-changes|base-branch)$"
```

### Configuration Item Descriptions

| Item | Description |
|------|-------------|
| `options.destination.prefix` | Prefix prepended to output destination paths |
| `params.two.directiveType.pattern` | Regex validation for c2 (action) |
| `params.two.layerType.pattern` | Regex validation for c3 (target) |

### Destination Prefix Behavior

```bash
# When prefix: "output/git" is set in user.yml

climpt-git create issue -o=tasks/task1.md
# Actual output destination: output/git/tasks/task1.md

# Without prefix configured
# Actual output destination: tasks/task1.md
```

---

## 6.4 registry_config.json (Registry Configuration)

Manage registries for multiple agents.

### File Location

Priority order (searched top to bottom):
1. `.agent/climpt/config/registry_config.json` (project)
2. `~/.agent/climpt/config/registry_config.json` (home)
3. Default configuration (auto-generated)

### Configuration Example

```json
{
  "registries": {
    "climpt": ".agent/climpt/registry.json",
    "inspector": ".agent/inspector/registry.json",
    "auditor": ".agent/auditor/registry.json"
  }
}
```

### Using Multiple Agents

```bash
# Search commands from different agents via MCP
search({ query: "commit", agent: "climpt" })
search({ query: "analyze", agent: "inspector" })
```

---

## 6.5 Configuration Priority

### Loading Order

```
1. Command-line options (highest priority)
   ↓
2. user.yml settings
   ↓
3. app.yml settings
   ↓
4. Default values
```

### Priority Example

```bash
# Command-line: -o=./custom/output
# user.yml: destination.prefix = "output/git"
# app.yml: (none)

# Result: ./custom/output (command-line takes priority)
```

### Config File Search Order

```
1. .agent/climpt/config/{domain}-app.yml
2. .agent/climpt/config/default-app.yml
3. Error (config file not found)
```

---

## Setting Up a New Domain

### Step 1: Create app.yml

```bash
cat > .agent/climpt/config/myapp-app.yml << 'EOF'
working_dir: ".agent/climpt"
app_prompt:
  base_dir: "prompts/myapp"
app_schema:
  base_dir: "schema/myapp"
EOF
```

### Step 2: Create user.yml (Optional)

```bash
cat > .agent/climpt/config/myapp-user.yml << 'EOF'
options:
  destination:
    prefix: "output/myapp"
params:
  two:
    directiveType:
      pattern: "^(create|update|delete)$"
    layerType:
      pattern: "^(item|list|detail)$"
EOF
```

### Step 3: Create Prompt Directory

```bash
mkdir -p .agent/climpt/prompts/myapp/create/item
```

### Step 4: Create Executable (For CLI Use)

```bash
cat > .deno/bin/climpt-myapp << 'EOF'
#!/bin/sh
case "$1" in
    -h|--help|-v|--version)
        exec deno run --allow-read --allow-write --allow-env --allow-run --allow-net --no-config 'jsr:@aidevtool/climpt' "$@"
        ;;
    *)
        exec deno run --allow-read --allow-write --allow-env --allow-run --allow-net --no-config 'jsr:@aidevtool/climpt' --config=myapp "$@"
        ;;
esac
EOF

chmod +x .deno/bin/climpt-myapp
```

---

## Related Guides

- [05-architecture.md](./05-architecture.md) - Architecture Overview
- [07-dependencies.md](./07-dependencies.md) - Dependencies (Registry, MCP)
- [08-prompt-structure.md](./08-prompt-structure.md) - Prompt Structure
