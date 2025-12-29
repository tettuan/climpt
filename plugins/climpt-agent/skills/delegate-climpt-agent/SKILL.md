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

## Input Components

This skill uses three distinct input mechanisms:

| Component | Purpose | Passed via | Used for |
|-----------|---------|------------|----------|
| **action** | What to do | `--action` arg | Command search (c2 matching) |
| **target** | What to act on | `--target` arg | Command search (c3 matching) |
| **intent** | Execution context | `--intent` arg | LLM option resolution |
| **content** | Detailed data | stdin pipe | Passed to climpt command |

### Flow Diagram

```
User Request
    │
    ├─► action ──────► Command Search ──► Match climpt command
    ├─► target ──────►     (RRF)
    │
    ├─► intent ──────► Option Resolution ──► CLI args (e.g., -e=feature)
    │                        (LLM)
    │
    └─► content ─────► stdin ──────────────► Climpt command input
         (pipe)
```

## Workflow

### Step 1: Create action, target, and intent

Analyze the user's request and create C3L-aligned queries:

**action**: ~6 word English phrase emphasizing the ACTION
- Focus on verbs and actions (run, test, commit, generate, create)
- Maps to c2 (action identifier)
- Used for cosine similarity search

**target**: ~6 word English phrase emphasizing the TARGET
- Focus on nouns and objects (test file, changes, frontmatter, document)
- Maps to c3 (target identifier)
- Used for cosine similarity search

**intent**: Detailed description of execution intent
- Describes WHAT the user wants to achieve
- Used by LLM to resolve command options
- Can be in any language (Japanese OK)
- If omitted, defaults to `action + target`

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

**Sandbox**: This script uses Claude Agent SDK, which requires `dangerouslyDisableSandbox: true` when called from Claude Code's Bash tool.

Parameters:
- `--action`: Action-focused query (~6 words, emphasizes verbs/c2) - required
- `--target`: Target-focused query (~6 words, emphasizes nouns/c3) - required
- `--intent`: Detailed intent for option resolution (optional, defaults to action+target)
- `--agent`: Agent name (default: "climpt")
- `--options`: Comma-separated list of additional options (optional)

### Step 3: Pass stdin content (when applicable)

If the user provides detailed content (file diffs, context, etc.), pipe it to the script.

**When stdin is piped, always use `dangerouslyDisableSandbox: true`.**

#### When to use stdin

| Scenario | Use stdin? | Example content |
|----------|------------|-----------------|
| Commit changes | Yes | `git diff --staged` output |
| Create document from context | Yes | Existing text, requirements |
| Generate code from spec | Yes | Specification text |
| Run tests | No | - |
| Search files | No | - |

#### Stdin vs Intent comparison

| Aspect | `--intent` | stdin |
|--------|-----------|-------|
| Purpose | LLM option resolution | Climpt command input |
| Length | Short (1-2 sentences) | Any length |
| Language | Any (Japanese OK) | Any |
| Required | No (defaults to action+target) | No |
| Used by | options-prompt.ts (LLM) | climpt command directly |

#### Example: Commit workflow

```bash
# intent = short description for option resolution
# stdin = actual diff content for commit message generation

git diff --staged | deno run ... -- <script.ts> \
  --action="commit save stage changes" \
  --target="unstaged changes semantic group" \
  --intent="新機能追加のコミットメッセージを作成"
```

Processing flow:
1. `--intent="新機能追加..."` → LLM resolves options (e.g., `-e=feature`)
2. `git diff` output → piped to climpt as stdin content
3. climpt generates commit message using both resolved options and diff content

#### Example: Requirement document creation

```bash
# User provided context as stdin
echo "要件:
- ユーザー認証機能
- OAuth2.0対応（Google, GitHub）
- セッション管理
- ロールベースアクセス制御" | deno run ... -- <script.ts> \
  --action="draft create write compose" \
  --target="specification document entry requirements" \
  --intent="ユーザー認証機能の要求資料を作成"
```

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

### "Import directory failed" error

If you see an error like:
```
error: Import 'file:///path/to/project' failed.
    0: Is a directory (os error 21)
```

**Cause**: The project has `node_modules/` directory (from npm/pnpm), causing Deno to use "manual" mode for npm package resolution. Deno then fails to find `@anthropic-ai/claude-agent-sdk` in the local node_modules.

**Solution**: Add `nodeModulesDir` setting to the project's `deno.json`:

```json
{
  "nodeModulesDir": "auto"
}
```

This tells Deno to resolve npm packages independently, ignoring the existing node_modules directory.

**Note**: This is a host project configuration, not a climpt-agent issue. Any project using both npm/pnpm and Deno tools should include this setting

### Sub-agent errors
The sub-agent runs independently and reports its own errors. Check:
1. Working directory is correct
2. Required tools are available
3. The instruction prompt was successfully retrieved

## Quick Reference

```
Parameter Summary:
  --action   Required  ~6 words, verbs (execute, create, commit)
  --target   Required  ~6 words, nouns (file, document, changes)
  --intent   Optional  1-2 sentences, for option resolution
  stdin      Optional  Detailed content piped to climpt

Decision Guide:
  User says...              → action           → target
  "テストして"               → run execute test  → specific file unit test
  "コミットして"             → commit save stage → changes semantic group
  "ドキュメント作成して"      → create write draft → document specification entry
  "検索して"                 → search find query → code files pattern

When to pipe stdin:
  ✓ Commit message: git diff --staged | ...
  ✓ Document creation: echo "context" | ...
  ✓ Code generation: cat spec.md | ...
  ✗ Test execution: no stdin needed
  ✗ File search: no stdin needed

Full command template:
  [stdin |] deno run --allow-read --allow-write --allow-net --allow-env --allow-run --allow-sys \
    -- ${CLAUDE_PLUGIN_ROOT}/skills/delegate-climpt-agent/scripts/climpt-agent.ts \
    --action="<verbs>" --target="<nouns>" [--intent="<description>"]
```
