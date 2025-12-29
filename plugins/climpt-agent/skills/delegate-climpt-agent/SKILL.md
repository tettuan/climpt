---
name: delegate-climpt-agent
description: Use when user mentions 'climpt' or 'climpt-agent', or gives project-specific instructions where general knowledge is insufficient. Climpt provides pre-configured prompts tailored to the project's workflow.
---

# Delegate Climpt Agent

Development task delegation through Climpt's command registry.

## Overview

This Skill connects Claude Code to Climpt by spawning independent sub-agents
using Claude Agent SDK. When a user's request matches a Climpt command, this
Skill creates search queries aligned with C3L (Command-Component-Context):

1. **action**: Action-focused query (maps to c2 - what to do)
2. **target**: Target-focused query (maps to c3 - what to act on)
3. **intent**: Detailed description for option resolution

## Workflow

### Step 1: Create action, target, and intent

Analyze the user's request and create C3L-aligned queries:

**action**: ~6 word English phrase emphasizing the ACTION
- Focus on verbs and actions (run, test, commit, generate, create)
- Maps to c2 (action identifier)

**target**: ~6 word English phrase emphasizing the TARGET
- Focus on nouns and objects (test file, changes, frontmatter, document)
- Maps to c3 (target identifier)

**intent**: Detailed description of execution intent

Examples:

| User Request | action | target | intent |
|-------------|--------|--------|--------|
| "climpt-agentのoptions-prompt.tsをテストして" | "run execute test verify" | "specific file unit test options" | "Test options-prompt.ts in climpt-agent scripts" |
| "変更をコミットして、semantic groupingで" | "commit save stage changes" | "unstaged changes semantic group" | "Commit staged changes with semantic grouping by file type" |
| "frontmatterを生成して、docs/配下に" | "generate build create output" | "frontmatter metadata document yaml" | "Generate frontmatter for markdown files in docs/ directory" |
| "仕様書を作成" | "draft create write compose" | "specification document entry requirements" | "Create a new requirements specification document" |

### Step 2: Execute sub-agent script

```bash
deno run --allow-read --allow-write --allow-net --allow-env --allow-run --allow-sys \
  -- ${CLAUDE_PLUGIN_ROOT}/skills/delegate-climpt-agent/scripts/climpt-agent.ts \
  --action="<action-focused query>" \
  --target="<target-focused query>" \
  --intent="<detailed intent>" \
  [--agent=climpt] \
  [--options=<opt1,opt2,...>]
```

**Important**: The `--` before the script path is required to separate Deno options from script arguments.

Parameters:
- `--action`: Action-focused query (~6 words, emphasizes verbs/c2) - required
- `--target`: Target-focused query (~6 words, emphasizes nouns/c3) - required
- `--intent`: Detailed intent for option resolution (optional, defaults to action+target)
- `--agent`: Agent name (default: "climpt")
- `--options`: Comma-separated list of additional options (optional)

### Step 3: Pass stdin content (when applicable)

If the user provides detailed content (file diffs, context, etc.), pipe it to the script:

```bash
echo "<detailed content>" | deno run ... -- <script.ts> --action="..." --target="..." --intent="..."
```

**Important**: `--intent` and stdin content serve different purposes:
- `--intent`: Short description for LLM option resolution (e.g., "新機能追加")
- stdin content: Detailed content passed to climpt (e.g., file diffs, code context)

Example:
```bash
git diff --staged | deno run ... -- <script.ts> \
  --action="commit save stage changes" \
  --target="unstaged changes semantic group" \
  --intent="新機能追加のコミットメッセージを作成"
```

Flow:
1. `--intent="新機能追加"` is used to resolve options (e.g., `-e=feature`)
2. `git diff` output is passed to climpt as stdin content

## When to Use This Skill

Use when the user gives project-specific instructions and it's unclear from general knowledge what should be done. Climpt provides pre-configured prompts tailored to the project's workflow.

## Error Handling

### Search returns no results
1. Inform the user that no matching Climpt command was found
2. Suggest alternative approaches or ask for clarification
3. Try rephrasing the query with different keywords

### Script execution fails
1. Check that Deno is installed and accessible
2. Verify Claude Agent SDK is available
3. Ensure all required permissions are granted
4. Check that registry.json exists

### Sub-agent errors
The sub-agent runs independently and reports its own errors. Check:
1. Working directory is correct
2. Required tools are available
3. The instruction prompt was successfully retrieved
