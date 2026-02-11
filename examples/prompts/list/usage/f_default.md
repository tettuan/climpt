---
title: Climpt Available Commands List Generation
description: Automatically generates available commands, options, and prompt combinations for Climpt and outputs them as a tools-list.md file. Creates command lists based on prompt file placement rules and analyzes frontmatter information and variables of each prompt to provide detailed usage instructions.
usage: climpt list usage
---

# Implementation Tasks

Create a list of available Climpt commands.

## What is Climpt

Deno JSR @https://jsr.io/@aidevtool/climpt. A tool designed to output prompts
via CLI. Replaces variables in prompt templates based on values passed as
parameters.

Normal usage:

```zsh
climpt-* <Directive> <Layer> --*
```

STDIN usage:

```zsh
echo "something" | climpt-* <Directive> <Layer> --*
```

Available prompts are specified by configuration directories. Therefore, by
examining command files, configuration files, and prompt files, we can create a
list of available commands.

Executable commands: `.deno/bin/climpt-*` Configuration:
`.agent/climpt/config/*.yml` Prompts: `.agent/climpt/prompts/**/f_*.md`

## Prompt Placement Rules

`.agent/climpt/prompts/<command_name>/<Directive>/<Layer>/f_<input>_<adaptation>.md`

## Options List

input_text : STDIN input_text_file : --from, -f destination_path :
--destination, -o uv-* : --uv-* (user-defined variables, e.g.,
--uv-scope=feature, --uv-threshold=80)

## Steps

### Section Creation

1. Read `.agent/climpt/tools-list.md`
2. Get "executable commands" from `.deno/bin/climpt-*`
3. Record in the sections of `.agent/climpt/tools-list.md` 3-1. If already
   exists, no need to record; if not, create new section

### Executable Commands List Creation

4. Get file list from prompt directories
5. Record commands in sections following "Prompt Placement Rules" 5-1. One line
   per prompt
6. Read prompt template contents and identify options 6-1. Extract {variable}
   patterns from template contents 6-2. Determine options from available
   variables based on "Options List"
7. Record availability in command columns

### Detailed Description Creation

8. If frontmatter exists, extract title, description, usage, options
9. Record detailed description for each executable command below the list table.

## Format

The format is as follows. Refer to "JSON Schema" for structure.

```
## climpt-design

|directive| layer | input(-i) | adaptation(-a) | input_text_file(-f) | input_text (STDIN) |destination(-o) | 
|--- |---|--- |---|--- |---| ---|
| domain | architecture | - | detail | ✓ | ✓ | - |
| domain | architecture | - | core | ✓ | ✓ | - |
| domain | boundary | - | subdomain | - | - | ✓ |

**climpt-design domain architecture --name=value**:
Frontmatter title here
Frontmatter description here.
input_text: Specify the current scope
input_text_file: Receive roughly described information
destination_path: Specify output destination with multiple files
uv-subdomain: Specify subdomain prefix
uv-scope: Scope of changes (e.g., 'feature', 'bugfix')
uv-threshold: Quality threshold percentage (e.g., '80')
```

```:NG, 2 prompt files in one line.
| domain | architecture | | detail, core | ok | ok | |
```

## Output Destination

`.agent/climpt/tools-list.md`

# JSON Schema

The following is a JSON schema that defines the structure of the output to be
created.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Climpt Tools List Output Schema",
  "type": "object",
  "properties": {
    "commands": {
      "type": "array",
      "description": "List of executable Climpt commands",
      "items": {
        "type": "object",
        "properties": {
          "commandName": {
            "type": "string",
            "description": "Command name (e.g., climpt-design)",
            "pattern": "^climpt-[a-z0-9-]+$"
          },
          "options": {
            "type": "array",
            "description": "Available option combinations",
            "items": {
              "type": "object",
              "properties": {
                "directive": {
                  "type": "string",
                  "description": "Directive name (e.g., domain)"
                },
                "layer": {
                  "type": "string",
                  "description": "Layer name (e.g., architecture, boundary)"
                },
                "inputOption": {
                  "type": "boolean",
                  "description": "Availability of input(-i) option"
                },
                "adaptationOption": {
                  "type": "string",
                  "description": "Value of adaptation(-a) option (e.g., detail, core, subdomain)"
                },
                "inputTextFileOption": {
                  "type": "boolean",
                  "description": "Availability of input_text_file(-f) option"
                },
                "inputTextStdin": {
                  "type": "boolean",
                  "description": "Availability of input_text (STDIN)"
                },
                "destinationOption": {
                  "type": "boolean",
                  "description": "Availability of destination(-o) option"
                }
              },
              "required": [
                "directive",
                "layer",
                "inputOption",
                "adaptationOption",
                "inputTextFileOption",
                "inputTextStdin",
                "destinationOption"
              ]
            }
          },
          "promptDetails": {
            "type": "array",
            "description": "Detailed descriptions for each prompt file",
            "items": {
              "type": "object",
              "properties": {
                "promptKey": {
                  "type": "string",
                  "description": "Prompt identification key (e.g., 'domain architecture --adaptation=detail')",
                  "pattern": "^[a-z]+ [a-z]+ --[a-z_]+=\\w+$"
                },
                "frontmatter": {
                  "type": "object",
                  "description": "Frontmatter information from prompt file",
                  "properties": {
                    "title": {
                      "type": "string",
                      "description": "Frontmatter title"
                    },
                    "description": {
                      "type": "string",
                      "description": "Frontmatter description"
                    }
                  },
                  "required": ["title", "description"]
                },
                "variables": {
                  "type": "object",
                  "description": "Description of variables used in the prompt (values passed via options)",
                  "additionalProperties": {
                    "type": "string",
                    "description": "Variable description"
                  },
                  "examples": [
                    {
                      "input_text": "Specify the current scope",
                      "input_text_file": "Receive roughly described information",
                      "destination_path": "Specify output destination with multiple files",
                      "uv-subdomain": "Specify subdomain prefix"
                    }
                  ]
                }
              },
              "required": ["promptKey", "frontmatter", "variables"]
            }
          }
        },
        "required": ["commandName", "options", "promptDetails"]
      }
    }
  },
  "required": ["commands"]
}
```
