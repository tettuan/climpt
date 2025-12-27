/**
 * @fileoverview Meta domain initialization module for climpt
 * @module init/meta-init
 */

import { dirname, resolve } from "@std/path";

/**
 * Check if a path exists
 */
async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    throw error;
  }
}

/**
 * Ensure directory exists, creating it if necessary
 */
async function ensureDir(path: string): Promise<void> {
  try {
    await Deno.mkdir(path, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.AlreadyExists)) {
      throw error;
    }
  }
}

/**
 * Meta domain 用の設定ファイルコンテンツ
 */
const META_APP_CONFIG = `# Build Configuration for meta domain
working_dir: ".agent/climpt"
app_prompt:
  base_dir: "prompts/meta"
app_schema:
  base_dir: "schema/meta"
`;

const META_USER_CONFIG = `# Breakdown Configuration for meta domain
params:
  two:
    directiveType:
      pattern: "^(build|create)$"
    layerType:
      pattern: "^(frontmatter|instruction)$"
`;

// 埋め込みプロンプト定義（META_PROMPTS より先に定義する必要がある）
const BUILD_FRONTMATTER_PROMPT = `---
c1: meta
c2: build
c3: frontmatter
title: Build C3L Prompt Frontmatter
description: Generate C3L v0.5 compliant frontmatter for Climpt instruction files
usage: climpt-meta build frontmatter
c3l_version: "0.5"
options:
  edition:
    - default
  adaptation:
    - default
    - detailed
  file: false
  stdin: true
  destination: true
---

# Build C3L Prompt Frontmatter

## Purpose

Generate valid C3L v0.5 compliant YAML frontmatter for new Climpt instruction files. All frontmatter fields MUST be written in English.

## Input

Provide the following information via stdin:
- Intended command purpose and description
- Target domain (code, git, meta, data, infra, etc.)
- Action verb (what the command does)
- Target object (what the command acts upon)

## Output

A complete YAML frontmatter block ready to be placed at the top of a markdown instruction file.

## C3L v0.5 Frontmatter Schema

### Required Fields

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| \`c1\` | string | Domain identifier | \`git\`, \`meta\`, \`code\` |
| \`c2\` | string | Action: verb or verb-modifier | \`group-commit\` |
| \`c3\` | string | Target: object or object-context | \`unstaged-changes\` |
| \`title\` | string | Human-readable title (English) | \`Group Commit Unstaged Changes\` |

### Optional Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| \`description\` | string | - | Detailed description of the command (English) |
| \`usage\` | string | - | Usage example: \`<c1> <c2> <c3>\` |
| \`c3l_version\` | string | \`"0.5"\` | C3L specification version |
| \`options\` | object | - | Command options configuration |
| \`uv\` | array | - | User-defined variables for \`{uv-*}\` templates |

### Options Structure

\`\`\`yaml
options:
  edition:      # Available edition variants
    - default
  adaptation:   # Available adaptation levels
    - default
    - detailed
  file: false   # Whether command accepts file input (-f)
  stdin: false  # Whether command accepts stdin input
  destination: false  # Whether command supports destination output (-o)
\`\`\`

### User Variables (uv)

The \`uv\` field is at the same level as \`options\` (not nested inside). When the instruction body contains \`{uv-*}\` template variables, declare them in the \`uv\` array. Each user variable maps to a CLI option \`--uv-<name>=<value>\`.

**Detection Rule**: Scan the instruction body for patterns matching \`{uv-*}\`. For each match, extract the variable name and add it to the \`uv\` array.

**Declaration Format**:
\`\`\`yaml
options:
  edition:
    - default
  file: false
  stdin: false
  destination: false
uv:
  - target_language: Target programming language for conversion
  - output_format: Desired output format (json, yaml, xml)
\`\`\`

**CLI Usage**:
\`\`\`bash
climpt-code convert source-file --uv-target_language=python --uv-output_format=json
\`\`\`

**Template Expansion**: \`{uv-target_language}\` → \`python\`, \`{uv-output_format}\` → \`json\`

## Naming Conventions

### c1 (Domain)

Format: \`<domain>\`

- Domain examples: \`git\`, \`meta\`, \`code\`, \`data\`, \`infra\`, \`sec\`, \`test\`, \`docs\`
- The agent is specified separately (e.g., \`agent: climpt\`)

Pattern: \`^[a-z]+$\`

### c2 (Action)

Format: \`<verb>\` or \`<verb>-<modifier>\`

Examples:
- Single verb: \`build\`, \`review\`, \`merge\`, \`fetch\`, \`analyze\`
- With modifier: \`group-commit\`, \`find-oldest\`, \`build-robust\`

Pattern: \`^[a-z]+(-[a-z]+)?$\`

### c3 (Target)

Format: \`<object>\` or \`<object>-<context>\`

Examples:
- Single object: \`frontmatter\`, \`branch\`, \`service\`
- With context: \`pull-request\`, \`unstaged-changes\`, \`api-service\`

Pattern: \`^[a-z]+(-[a-z]+)?$\`

## Example Output

### Basic Example

\`\`\`yaml
---
c1: code
c2: review
c3: pull-request
title: Review Pull Request Code
description: Review pull request changes and provide improvement suggestions and bug identification
usage: climpt-code review pull-request
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
\`\`\`

### Example with User Variables

When the instruction body contains \`{uv-*}\` templates, declare them in frontmatter at the same level as \`options\`:

\`\`\`yaml
---
c1: code
c2: convert
c3: source-file
title: Convert Source File
description: Convert source code to a different programming language
usage: climpt-code convert source-file
c3l_version: "0.5"
options:
  edition:
    - default
  adaptation:
    - default
  file: true
  stdin: false
  destination: true
uv:
  - target_language: Target programming language for conversion
  - style_guide: Code style guide to follow (optional)
---
\`\`\`

This frontmatter declares that the instruction uses \`{uv-target_language}\` and \`{uv-style_guide}\` in its body.

## Language Requirement

**IMPORTANT**: All frontmatter values MUST be written in English:
- \`title\`: English title
- \`description\`: English description
- Field names and values use lowercase English with hyphens

## Validation Rules

1. Exactly 3 semantic tokens (c1, c2, c3) before options
2. c1 is the domain identifier (e.g., \`git\`, \`meta\`, \`code\`)
3. Hyphens allowed only within tokens, not between them
4. All string values in English
5. c3l_version should be quoted: \`"0.5"\`
`;

const CREATE_INSTRUCTION_PROMPT = `---
c1: meta
c2: create
c3: instruction
title: Create New Climpt Instruction
description: Create a new Climpt instruction file from stdin input, following C3L specification with all required configurations
usage: climpt-meta create instruction
c3l_version: "0.5"
options:
  edition:
    - default
  adaptation:
    - default
    - detailed
  file: false
  stdin: true
  destination: true
---

# Create New Climpt Instruction

## Purpose

Create a new Climpt instruction file following the C3L specification. This process includes:
1. Naming the command according to C3L conventions
2. Creating the markdown prompt file under \`.agent/climpt/prompts/\`
3. Verifying/creating the executable in \`.deno/bin/\`
4. Verifying/updating configuration files in \`.agent/climpt/config/\`

## Input

This command receives input via stdin. Provide the following information through stdin:

- Purpose and description of the new instruction
- Target domain (code, git, meta, data, infra, etc.)
- Action verb (what the command does)
- Target object (what the command acts upon)

### Usage Example

\`\`\`bash
# Provide input via stdin using echo or heredoc
echo "Create a command to analyze code complexity in the code domain" | climpt-meta create instruction

# Or use heredoc for multi-line input
climpt-meta create instruction << 'EOF'
Purpose: Analyze and report code complexity metrics
Domain: code
Action: analyze
Target: complexity
Description: Calculate cyclomatic complexity and provide improvement suggestions
EOF
\`\`\`

The stdin input is used to determine c1 (domain), c2 (action), c3 (target) and generate the appropriate instruction file structure.

## Step 1: Find and Review C3L Specification

Before creating a new instruction, locate the latest C3L specification:

\`\`\`bash
# Find the latest C3L specification document
find docs -name "c3l_specification*.md" -o -name "c3l*.md" | head -1
# Or search for C3L documentation
grep -rl "C3L.*Specification" docs/
\`\`\`

Review the specification to understand:
- c1: Domain identifier (e.g., \`git\`, \`meta\`, \`code\`)
- c2: Action format (verb or verb-modifier)
- c3: Target format (object or object-context)

## Step 2: Naming Convention (C3L Compliant)

### c1 (Domain)

Format: \`<domain>\`

Common domains: \`git\`, \`meta\`, \`code\`, \`data\`, \`infra\`, \`sec\`, \`test\`, \`docs\`

The agent is specified separately in registry and MCP calls (e.g., \`agent: climpt\`).

Pattern: \`^[a-z]+$\`

### c2 (Action)

Format: \`<verb>\` or \`<verb>-<modifier>\`

Examples:
- Single: \`build\`, \`review\`, \`merge\`, \`fetch\`, \`analyze\`, \`create\`
- Compound: \`group-commit\`, \`find-oldest\`, \`build-robust\`

Pattern: \`^[a-z]+(-[a-z]+)?$\`

### c3 (Target)

Format: \`<object>\` or \`<object>-<context>\`

Examples:
- Single: \`frontmatter\`, \`branch\`, \`service\`, \`instruction\`
- Compound: \`pull-request\`, \`unstaged-changes\`, \`api-service\`

Pattern: \`^[a-z]+(-[a-z]+)?$\`

## Step 3: Create Prompt File

### Directory Structure

\`\`\`
.agent/climpt/prompts/<domain>/<c2>/<c3>/
\`\`\`

Example for \`climpt-git group-commit unstaged-changes\`:
\`\`\`
.agent/climpt/prompts/git/group-commit/unstaged-changes/f_default.md
\`\`\`

### File Naming

- \`f_default.md\` - Default edition
- \`f_detailed.md\` - Detailed edition (if needed)

### Generate Frontmatter

Use \`climpt-meta build frontmatter\` to generate C3L v0.5 compliant frontmatter:

\`\`\`bash
# Generate frontmatter from stdin input
echo "Domain: code, Action: analyze, Target: complexity, Purpose: Calculate cyclomatic complexity" | climpt-meta build frontmatter

# Or use heredoc
climpt-meta build frontmatter << 'EOF'
Domain: code
Action: analyze
Target: complexity
Purpose: Calculate cyclomatic complexity and provide improvement suggestions
EOF
\`\`\`

The \`build frontmatter\` command generates valid YAML frontmatter following C3L v0.5 specification with all required fields (c1, c2, c3, title, description, usage, options).

**IMPORTANT**: All frontmatter values MUST be in English.

### Create the File

\`\`\`bash
# Create directory
mkdir -p .agent/climpt/prompts/<domain>/<c2>/<c3>/

# Create prompt file with frontmatter and content
# Write the instruction content in markdown format
\`\`\`

## Step 4: Verify/Create Executable

Check if executable exists for the domain:

\`\`\`bash
# Check for existing executable
ls -la .deno/bin/climpt-<domain>

# If not found, create it
cat > .deno/bin/climpt-<domain> << 'EOF'
#!/bin/sh
# generated by deno install

# Check if help or version is requested
case "$1" in
    -h|--help|-v|--version)
        exec deno run --allow-read --allow-write --allow-env --allow-run --allow-net --no-config 'jsr:@aidevtool/climpt' "$@"
        ;;
    *)
        exec deno run --allow-read --allow-write --allow-env --allow-run --allow-net --no-config 'jsr:@aidevtool/climpt' --config=<domain> "$@"
        ;;
esac
EOF

# Make executable
chmod +x .deno/bin/climpt-<domain>
\`\`\`

## Step 5: Verify/Update Configuration Files

### App Configuration (.agent/climpt/config/<domain>-app.yml)

Check if exists:
\`\`\`bash
ls -la .agent/climpt/config/<domain>-app.yml
\`\`\`

If not exists, create:
\`\`\`yaml
# Build Configuration
working_dir: ".agent/climpt"
app_prompt:
  base_dir: "prompts/<domain>"
app_schema:
  base_dir: "schema/<domain>"
\`\`\`

### User Configuration (.agent/climpt/config/<domain>-user.yml)

Check if exists:
\`\`\`bash
ls -la .agent/climpt/config/<domain>-user.yml
\`\`\`

If exists, verify the pattern includes the new c2 (action):
\`\`\`yaml
# Breakdown Configuration
params:
  two:
    directiveType:
      pattern: "^(existing-action|new-action)$"  # Add new c2 here
    layerType:
      pattern: "^(existing-target|new-target)$"  # Add new c3 here
\`\`\`

If not exists, create:
\`\`\`yaml
# Breakdown Configuration
params:
  two:
    directiveType:
      pattern: "^(<c2>)$"
    layerType:
      pattern: "^(<c3>)$"
\`\`\`

## Step 6: Regenerate Registry

After creating all files, regenerate the registry:

\`\`\`bash
deno task generate-registry
\`\`\`

This updates \`.agent/climpt/registry.json\` with the new command.

## Step 7: Verify Tests

Run tests to ensure the new instruction is properly configured:

\`\`\`bash
deno task test
\`\`\`

## Output Checklist

After completion, verify the following files exist and are correct:

- [ ] \`.agent/climpt/prompts/<domain>/<c2>/<c3>/f_default.md\`
- [ ] \`.deno/bin/climpt-<domain>\` (executable, chmod +x)
- [ ] \`.agent/climpt/config/<domain>-app.yml\`
- [ ] \`.agent/climpt/config/<domain>-user.yml\` (with matching patterns)
- [ ] \`.agent/climpt/registry.json\` (regenerated)

## Example: Creating \`climpt-data fetch stock-prices\`

1. **Naming**:
   - c1: \`data\` (domain)
   - c2: \`fetch\` (action)
   - c3: \`stock-prices\` (target)

2. **Create prompt**:
   \`\`\`bash
   mkdir -p .agent/climpt/prompts/data/fetch/stock-prices/
   # Create f_default.md with appropriate content
   \`\`\`

3. **Create executable**:
   \`\`\`bash
   cat > .deno/bin/climpt-data << 'EOF'
   #!/bin/sh
   case "$1" in
       -h|--help|-v|--version)
           exec deno run ... 'jsr:@aidevtool/climpt' "$@"
           ;;
       *)
           exec deno run ... 'jsr:@aidevtool/climpt' --config=data "$@"
           ;;
   esac
   EOF
   chmod +x .deno/bin/climpt-data
   \`\`\`

4. **Create configs**:
   \`\`\`bash
   # data-app.yml
   working_dir: ".agent/climpt"
   app_prompt:
     base_dir: "prompts/data"
   app_schema:
     base_dir: "schema/data"

   # data-user.yml
   params:
     two:
       directiveType:
         pattern: "^(fetch)$"
       layerType:
         pattern: "^(stock-prices)$"
   \`\`\`

5. **Regenerate registry**:
   \`\`\`bash
   deno task generate-registry
   \`\`\`
`;

/**
 * Meta domain prompts (埋め込み)
 */
const META_PROMPTS: Record<string, string> = {
  "build/frontmatter/f_default.md": BUILD_FRONTMATTER_PROMPT,
  "create/instruction/f_default.md": CREATE_INSTRUCTION_PROMPT,
};

/**
 * Meta domain 初期化を実行
 */
export async function initMetaDomain(
  workingDir: string,
  force: boolean,
): Promise<{ created: string[]; skipped: string[] }> {
  const result = { created: [] as string[], skipped: [] as string[] };
  const configDir = resolve(workingDir, "config");
  const promptsDir = resolve(workingDir, "prompts");

  // 1. meta-app.yml 生成
  const metaAppResult = await createMetaAppYml(configDir, force);
  result.created.push(...metaAppResult.created);
  result.skipped.push(...metaAppResult.skipped);

  // 2. meta-user.yml 生成
  const metaUserResult = await createMetaUserYml(configDir, force);
  result.created.push(...metaUserResult.created);
  result.skipped.push(...metaUserResult.skipped);

  // 3. meta prompts 配置
  const promptsResult = await deployMetaPrompts(promptsDir, force);
  result.created.push(...promptsResult.created);
  result.skipped.push(...promptsResult.skipped);

  return result;
}

/**
 * meta-app.yml を生成
 */
async function createMetaAppYml(
  configDir: string,
  force: boolean,
): Promise<{ created: string[]; skipped: string[] }> {
  const result = { created: [] as string[], skipped: [] as string[] };
  const path = resolve(configDir, "meta-app.yml");

  if ((await exists(path)) && !force) {
    result.skipped.push(path);
    console.log(`  Skip: ${path} (already exists)`);
    return result;
  }

  await ensureDir(configDir);
  await Deno.writeTextFile(path, META_APP_CONFIG);
  result.created.push(path);
  console.log(`  Created: ${path}`);

  return result;
}

/**
 * meta-user.yml を生成
 */
async function createMetaUserYml(
  configDir: string,
  force: boolean,
): Promise<{ created: string[]; skipped: string[] }> {
  const result = { created: [] as string[], skipped: [] as string[] };
  const path = resolve(configDir, "meta-user.yml");

  if ((await exists(path)) && !force) {
    result.skipped.push(path);
    console.log(`  Skip: ${path} (already exists)`);
    return result;
  }

  await Deno.writeTextFile(path, META_USER_CONFIG);
  result.created.push(path);
  console.log(`  Created: ${path}`);

  return result;
}

/**
 * Meta domain prompts を配置
 */
async function deployMetaPrompts(
  promptsDir: string,
  force: boolean,
): Promise<{ created: string[]; skipped: string[] }> {
  const result = { created: [] as string[], skipped: [] as string[] };
  const metaDir = resolve(promptsDir, "meta");

  for (const [relativePath, content] of Object.entries(META_PROMPTS)) {
    const fullPath = resolve(metaDir, relativePath);
    const dir = dirname(fullPath);

    if ((await exists(fullPath)) && !force) {
      result.skipped.push(fullPath);
      console.log(`  Skip: ${fullPath} (already exists)`);
      continue;
    }

    await ensureDir(dir);
    await Deno.writeTextFile(fullPath, content);
    result.created.push(fullPath);
    console.log(`  Created: ${fullPath}`);
  }

  return result;
}
