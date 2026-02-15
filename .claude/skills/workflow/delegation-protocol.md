# Delegation Protocol

## Agent Type by Purpose

| Purpose | Agent Type | What it does |
|---------|-----------|-------------|
| File exploration, code discovery, codebase search | Explore | Read-only; cannot edit files |
| Design comparison, architecture options, planning | Plan | Read-only; produces analysis |
| Implementation, testing, verification, file edits | general-purpose | Full tool access |

## Multi-Agent Conflict Resolution

When two Sub Agents edit the same file, conductor judges the merge manually. Do not auto-combine.

```
Sub Agent A edits factory.ts (lines 10-30)
Sub Agent B edits factory.ts (lines 25-50)
→ Conductor reads both diffs, decides which changes to keep, applies manually
```

## Task Prompt Structure

Every Sub Agent launch must specify four elements in the prompt:

| Element | Example |
|---------|---------|
| Goal | "Find all consumers of createCompletionHandler" |
| Input | "Start from agents/completion/factory.ts" |
| Expected output | "List of file:line pairs with import/call sites" |
| Output path | "Write results to tmp/investigation/consumers.md" |
