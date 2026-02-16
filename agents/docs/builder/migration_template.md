# Agent Migration Request Form

## Overview

Information collection template for migrating existing agents to the
climpt-agents framework.

---

## 1. Basic Information

### Agent Identification

| Item                                   | Fill In |
| -------------------------------------- | ------- |
| Current Agent Name                     |         |
| Post-Migration Agent Name (kebab-case) |         |
| Display Name                           |         |
| Description                            |         |

### Current Implementation Location

```
Repository:
File Path:
```

---

## 2. Boundaries Settings (`runner.boundaries`)

### Tools Used (`runner.boundaries.allowedTools`)

Check currently used tools:

- [ ] Read - File reading
- [ ] Write - File writing
- [ ] Edit - File editing
- [ ] Glob - File search
- [ ] Grep - Content search
- [ ] Bash - Command execution
- [ ] WebFetch - Web fetching
- [ ] WebSearch - Web search
- [ ] Task - Sub-agent
- [ ] Other: _______________

### Permission Mode (`runner.boundaries.permissionMode`)

- [ ] `plan` - Plan mode (no edits)
- [ ] `acceptEdits` - Edit approval mode
- [ ] `bypassPermissions` - Permission bypass

### Sandbox (`runner.boundaries.sandbox`)

- [ ] Can operate with Sandbox enabled
- [ ] Requires Sandbox disabled

---

## 3. Completion Settings (`runner.completion`)

### Completion Type (`runner.completion.type`) (Select One)

- [ ] **keywordSignal** - Complete on specific keyword
  - Completion keyword: `_______________`

- [ ] **iterationBudget** - Complete after fixed iterations
  - Maximum iterations: `___`

- [ ] **externalState** - Complete when GitHub Issue closes
  - Issue number parameter name: `_______________`

- [ ] **stepMachine** - Complete via step-based state transitions
  - Number of steps: `___`
  - Step structure: `_______________`
  - (Example: analyze -> implement -> review)

- [ ] **custom** - Custom completion logic
  - Logic description: `_______________`

### Additional Information for stepFlow

**Fill in only if stepFlow is selected**

#### Step List

| Step Name     | Description  | Iterations | Next Step | On Failure |
| ------------- | ------------ | ---------- | --------- | ---------- |
| e.g., analyze | Analyze code | 1 time     | implement | retry (2x) |
|               |              |            |           |            |
|               |              |            |           |            |
|               |              |            |           |            |

#### Check Conditions

Completion determination method for each step:

```
Example:
- analyze step: OK if issue list is output
- implement step: OK if all tests pass
- review step: OK if quality criteria met
```

---

## 4. Parameters

### Input Parameter List

| Parameter Name | Type   | Required | CLI Flag | Default | Description  |
| -------------- | ------ | -------- | -------- | ------- | ------------ |
| topic          | string | Yes      | --topic  | -       | Task content |
|                |        |          |          |         |              |
|                |        |          |          |         |              |
|                |        |          |          |         |              |

### Validation

Special validation if any:

```
Example: focus must be one of ["general", "security", "performance"]
```

---

## 5. Prompts

### System Prompt

Full current system prompt or file path:

```markdown
<!-- Paste system prompt here -->
```

### Initial Prompt

Prompt used at agent start:

```markdown
<!-- Paste initial prompt here -->
```

### Continuation Prompt (for iterations)

Prompt used for 2nd iteration and beyond:

```markdown
<!-- Paste continuation prompt here -->
```

### Step Flow Prompts (if stepFlow selected)

**Fill in only if stepFlow is selected**

Prompts for each step:

| Step Name | Prompt File or Content |
| --------- | ---------------------- |
| analyze   |                        |
| implement |                        |
| review    |                        |

Prompts for each check:

| Check Target               | Prompt File or Content |
| -------------------------- | ---------------------- |
| analyze completion check   |                        |
| implement completion check |                        |
| final completion check     |                        |

### Variables

Variables used in prompts:

| Variable Name | Description  | Value Source  |
| ------------- | ------------ | ------------- |
| `{uv-topic}`  | Task content | CLI parameter |
|               |              |               |
|               |              |               |

---

## 6. Action Output

### Action Types Used

- [ ] **github-issue** - Issue creation
- [ ] **github-comment** - Issue comment
- [ ] **file** - File output
- [ ] **log** - Log output
- [ ] No actions used

### Current Output Format

Example of action output from agent:

````markdown
```action
{
  "type": "github-issue",
  "content": "...",
  "metadata": { ... }
}
```
````

---

## 7. GitHub Integration

- [ ] Uses GitHub integration

### Label Mapping

| Internal Name | GitHub Label |
| ------------- | ------------ |
| bug           | bug          |
| enhancement   | enhancement  |
|               |              |

---

## 8. Current Operation Flow

Describe agent operation flow in bullet points:

**Traditional Model Example:**

```
1. Receive task content via --topic from user
2. Analyze codebase
3. Create Issue if problem found
4. Output completion keyword "DONE"
```

**Step Flow Model Example:**

```
1. Receive task content via --topic from user
2. [analyze step] Analyze code
   - Check: Was issue list output? -> OK: next, NG: retry
3. [implement step] Fix issues
   - Check: Do tests pass? -> OK: next, NG: back to analyze
4. [review step] Review fixes
   - Check: Quality criteria met? -> OK: complete, NG: back to implement
```

---

## 9. Migration Notes

### Known Constraints/Requirements

```
Example:
- Assumes specific directory structure
- Requires environment variable XXX
- Requires gh command authentication
```

### Desired Changes Post-Migration

```
Example:
- Change completion condition from manual to iterate
- Add new action types
```

---

## 10. Test Method

Verification method after migration:

```bash
# Execution command example
deno task agent --agent {agent-name} --topic "Test task"

# Expected results
- xxx is output
- Issue is created
```

---

## Attachments

- [ ] Current agent configuration file
- [ ] System prompt file
- [ ] Operation log samples
- [ ] Other: _______________
