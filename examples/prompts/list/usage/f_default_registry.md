---
title: Climpt Registry.json Generation
description: Automatically generates a registry.json file for MCP server configuration by analyzing existing Climpt commands, configurations, and prompt files. Creates a comprehensive tool registry following the C3L (Climpt 3-word Language) specification.
usage: climpt list usage --adaptation=registry
---

# Implementation Tasks

Generate a complete `.agent/climpt/registry.json` file for MCP server
configuration.

## What is Registry.json

The registry.json file is the central configuration for Climpt's MCP (Model
Context Protocol) server. It defines:

- Available tools that can be invoked through MCP
- Command mappings following the C3L specification
- Tool descriptions and usage examples for AI assistants

## C3L (Climpt 3-word Language) Structure

Commands follow the pattern:

```
climpt-<c1> <c2> <c3>
```

Where:

- **c1**: Domain/category (git, spec, test, code, docs, meta)
- **c2**: Action/directive (create, analyze, execute, validate, generate, etc.)
- **c3**: Target/layer (refinement-issue, quality-metrics, implementation, etc.)

## Source Analysis

Analyze the following sources to build the registry:

1. **Prompt directories**: `.agent/climpt/prompts/*/`
2. **Configuration files**: `.agent/climpt/config/*.yml`
3. **Prompt templates**: `.agent/climpt/prompts/**/f_*.md`
4. **C3L specification**: `docs/c3l_specification_v0.4.md` (if exists)

## Prompt Discovery Rules

Prompts follow the structure:
`.agent/climpt/prompts/<c1>/<c2>/<c3>/f_<input>_<adaptation>.md`

From this structure, derive:

- Tool name from directory: `<c1>`
- Command from path: `<c1>/<c2>/<c3>`
- Description from frontmatter

## Generation Steps

### Step 1: Tool Discovery

1. Scan `.agent/climpt/prompts/*/` for available tools
2. Extract tool names from directory names (e.g., `git` directory → tool name:
   `git`)
3. Read configuration files for tool descriptions

### Step 2: Command Mapping

1. Traverse `.agent/climpt/prompts/` directory structure
2. For each prompt file found:
   - Extract c1/c2/c3 from path
   - Read frontmatter for descriptions
   - Create command entry

### Step 3: Build Registry Structure

1. Create `availableConfigs` array with discovered tools
2. Create `commands` array with all c1/c2/c3 combinations
3. Generate appropriate descriptions and usage examples

### Step 4: Validate and Output

1. Ensure all commands have valid C3L structure
2. Verify tool references are consistent
3. Output formatted JSON to `.agent/climpt/registry.json`

## Output Format

Generate the following structure:

```json
{
  "tools": {
    "availableConfigs": [
      {
        "name": "string", // Tool identifier (e.g., "git")
        "description": "string", // Human-readable description
        "usage": "string" // Example usage with options
      }
    ],
    "commands": [
      {
        "c1": "string", // Domain (git, spec, test, etc.)
        "c2": "string", // Action (create, analyze, etc.)
        "c3": "string", // Target (refinement-issue, etc.)
        "description": "string" // Command description
      }
    ]
  }
}
```

## Tool Categories

Standard tool categories to include:

| Tool | Description                              | Primary Actions             |
| ---- | ---------------------------------------- | --------------------------- |
| git  | Git operations and repository management | create, analyze, merge      |
| spec | Specification analysis and management    | analyze, validate, define   |
| test | Testing and verification operations      | execute, generate, validate |
| code | Code generation and development tasks    | create, refactor, optimize  |
| docs | Documentation generation and management  | generate, update, validate  |
| meta | Meta operations and command management   | list, resolve, inspect      |

## Example Registry Entry

For a prompt at
`.agent/climpt/prompts/git/create/refinement-issue/f_default.md`:

Tool entry:

```json
{
  "name": "git",
  "description": "Git operations and repository management",
  "usage": "climpt-git create refinement-issue --from=requirements.md"
}
```

Command entry:

```json
{
  "c1": "git",
  "c2": "create",
  "c3": "refinement-issue",
  "description": "Create a refinement issue from requirements documentation"
}
```

## Validation Rules

1. **Tool Uniqueness**: Each tool name in `availableConfigs` must be unique
2. **Command Completeness**: Every command must have all c1/c2/c3 fields
3. **Reference Consistency**: All c1 values in commands must have corresponding
   tool in `availableConfigs`
4. **Description Requirements**: All entries must have non-empty descriptions

## Output Destination

`.agent/climpt/registry.json`

# JSON Schema

The following schema defines the structure of the registry.json output:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Climpt MCP Registry Schema",
  "type": "object",
  "required": ["tools"],
  "properties": {
    "tools": {
      "type": "object",
      "required": ["availableConfigs", "commands"],
      "properties": {
        "availableConfigs": {
          "type": "array",
          "description": "Available tool configurations for MCP server",
          "items": {
            "type": "object",
            "required": ["name", "description", "usage"],
            "properties": {
              "name": {
                "type": "string",
                "description": "Tool identifier",
                "pattern": "^[a-z][a-z0-9-]*$",
                "examples": ["git", "spec", "test", "code", "docs", "meta"]
              },
              "description": {
                "type": "string",
                "description": "Human-readable tool description",
                "minLength": 10
              },
              "usage": {
                "type": "string",
                "description": "Example usage pattern",
                "pattern": "^climpt-[a-z][a-z0-9-]* .+"
              }
            }
          },
          "minItems": 1,
          "uniqueItems": true
        },
        "commands": {
          "type": "array",
          "description": "C3L command registry",
          "items": {
            "type": "object",
            "required": ["c1", "c2", "c3", "description"],
            "properties": {
              "c1": {
                "type": "string",
                "description": "Domain/category",
                "pattern": "^[a-z][a-z0-9-]*$"
              },
              "c2": {
                "type": "string",
                "description": "Action/directive",
                "pattern": "^[a-z][a-z0-9-]*$"
              },
              "c3": {
                "type": "string",
                "description": "Target/layer",
                "pattern": "^[a-z][a-z0-9-]*$"
              },
              "description": {
                "type": "string",
                "description": "Command description",
                "minLength": 10
              }
            }
          },
          "minItems": 1
        }
      }
    }
  }
}
```

## Additional Notes

- When frontmatter is missing, generate descriptions based on directory
  structure and file naming
- Prioritize commands that have actual prompt files over theoretical
  combinations
- Include usage examples that demonstrate real-world scenarios
- Ensure descriptions are clear and actionable for AI assistants
