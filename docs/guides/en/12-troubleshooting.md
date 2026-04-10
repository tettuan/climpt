[English](../en/12-troubleshooting.md) | [日本語](../ja/12-troubleshooting.md)

# 12. Troubleshooting Guide

A consolidated reference for diagnosing and resolving errors across Climpt and
Iterate Agent.

---

## Quick Error Index

| Error Message / Keyword                        | Section                                                                                                           |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `gh: command not found`                        | [1.2 gh CLI not found](#12-gh-cli-not-found--auth-failure)                                                        |
| `deno: command not found`                      | [1.1 Deno not found](#11-deno-not-found--version-mismatch)                                                        |
| `Permission denied` / `EACCES` / `EPERM`       | [1.3 Permission denied](#13-permission-denied)                                                                    |
| `Configuration load failed at`                 | [2.1 Configuration file not found](#21-configuration-file-not-found)                                              |
| `Unknown key: runner.completion`               | [2.2 Unknown key warnings](#22-unknown-key-warnings-legacy-format)                                                |
| `Prompt not found:`                            | [2.3 Validation failure](#23-validation-failure)                                                                  |
| `rate limit` / `429` / `Too many requests`     | [3.1 Rate limit / API errors](#31-rate-limit--api-errors)                                                         |
| `Cannot execute SDK query() in double sandbox` | [3.2 Sandbox restrictions](#32-sandbox-restrictions)                                                              |
| `Claude Code process exited with code 1`       | [3.2 Sandbox restrictions](#32-sandbox-restrictions) / [3.4 permissionMode mismatch](#34-permissionmode-mismatch) |
| `Empty output from breakdown CLI`              | [4.1 Empty output](#41-empty-output-from-breakdown-cli)                                                           |
| `FAILED_STEP_ROUTING`                          | [4.2 Step routing errors](#42-step-routing-errors)                                                                |
| `GATE_INTERPRETATION_ERROR`                    | [4.2 Step routing errors](#42-step-routing-errors)                                                                |
| `Maximum iterations (N) reached`               | [4.3 Verdict / completion failures](#43-verdict--completion-failures)                                             |
| `C3L prompt file not found`                    | [4.4 C3L prompt file not found](#44-c3l-prompt-file-not-found)                                                    |
| `AGENT_NOT_INITIALIZED`                        | [4.5 Initialization errors](#45-initialization-and-worktree-errors)                                               |
| `UV variable has no identified supply source`  | [4.6 UV Reachability Errors](#46-uv-reachability-errors)                                                          |

---

## 1. Environment Errors

### 1.1 Deno not found / version mismatch

**Symptom**: `deno: command not found` or unexpected API errors after running
commands.

**Cause**: Deno is not installed, or the installed version is below 2.5.

**Resolution**:

```bash
# Install Deno
curl -fsSL https://deno.land/install.sh | sh

# Verify version (requires 2.5+)
deno --version
```

**Prevention**: Pin the Deno version in your CI configuration and document it in
the project README.

---

### 1.2 gh CLI not found / auth failure

**Symptom**: `gh: command not found`, or `gh auth status` reports "not logged
in".

**Cause**: GitHub CLI is not installed or not authenticated.

**Resolution**:

```bash
# Install (macOS)
brew install gh

# Authenticate interactively
gh auth login

# Verify
gh auth status
```

**Prevention**: Run `gh auth status` as part of your project setup checklist.
See [01-prerequisites.md](./01-prerequisites.md).

---

### 1.3 Permission denied

**Symptom**: `Permission denied`, `EACCES`, or `operation not permitted` during
file operations or command execution.

**Cause**: File-system permissions are insufficient, or sandbox restrictions
block access.

**Resolution**:

1. Check file ownership and permissions:
   ```bash
   ls -la .agent/
   ```
2. If running inside Claude Code, the sandbox may restrict write access. Use
   `dangerouslyDisableSandbox: true` in the Bash tool call or run from an
   external terminal.

**Prevention**: Run agent commands from a terminal where the current user owns
the project directory.

---

### 1.4 Network / Proxy issues

**Symptom**: `ECONNREFUSED`, `ETIMEDOUT`, `ENOTFOUND`, or `socket hang up`.

**Cause**: Network connectivity problems, VPN/proxy configuration, or DNS
resolution failure.

**Resolution**:

1. Verify network connectivity:
   ```bash
   curl -s https://api.anthropic.com/health
   ```
2. If behind a proxy, configure `HTTPS_PROXY`:
   ```bash
   export HTTPS_PROXY=http://proxy.example.com:8080
   ```
3. The runner automatically retries transient network errors with exponential
   backoff (base 5 s, max 60 s).

**Prevention**: Ensure stable connectivity before starting long-running agent
sessions.

---

## 2. Configuration Errors

### 2.1 Configuration file not found

**Symptom**: `ConfigError` (code: AC-LOAD-001 to AC-LOAD-003) with message
`Configuration load failed at <path>`.

**Cause**: The `agent.json`, `config.json`, or prompt templates are missing.
Initialization was skipped or ran in the wrong directory.

**Resolution**:

```bash
cd your-project
deno run -A jsr:@aidevtool/climpt/agents/iterator --init
```

**Prevention**: Always run `--init` from the project root before first
execution.

---

### 2.2 Unknown key warnings (legacy format)

**Symptom**: Warnings such as `Unknown key: runner.completion` or
`Unknown key: completionConditions`.

**Cause**: The configuration uses v1.12.0 key names that were renamed in
v1.13.0.

**Resolution**: Rename keys per the migration mapping:

| Old Key                | New Key                |
| ---------------------- | ---------------------- |
| `runner.completion`    | `runner.verdict`       |
| `completionKeyword`    | `verdictKeyword`       |
| `completionConditions` | `validationConditions` |
| `completionSteps`      | `validationSteps`      |
| `completionPatterns`   | `failurePatterns`      |

See [09-migration-guide.md](./09-migration-guide.md) for the full mapping.

**Prevention**: Run `--validate` after editing configuration files.

---

### 2.3 Validation failure

**Symptom**: `ConfigError` (code: PR-FILE-001) (`Prompt not found: <path>`),
missing required fields, or invalid enum values for `permissionMode` or
`runner.verdict.type`.

**Cause**: Configuration contains typos, missing required fields, or values
outside the allowed set.

**Resolution**:

1. Run the validation command:
   ```bash
   deno task agent --agent <name> --validate
   ```
2. Check enum values against the reference:
   - `permissionMode`: `default`, `plan`, `acceptEdits`, `bypassPermissions`
   - `runner.verdict.type`: `detect:keyword`, `count:iteration`, `poll:state`,
     `detect:graph`, `meta:custom`

**Prevention**: Always validate before running:
`deno task agent --agent <name> --validate`.

---

### 2.4 Schema validation errors

**Symptom**: `SchemaPointerError` or `MalformedSchemaIdentifierError` in logs.

**Cause**: `outputSchemaRef` in `steps_registry.json` references a non-existent
pointer or uses malformed JSON Pointer syntax.

**Resolution**:

1. Verify the schema file exists under the `.agent/{agentId}/schemas` directory.
2. Ensure `outputSchemaRef` uses the object format:
   ```json
   {
     "outputSchemaRef": {
       "file": "step-output.schema.json",
       "schema": "initial.assess"
     }
   }
   ```
3. Confirm the `schema` key exists in the `definitions` section of the schema
   file.

**Prevention**: Use standard JSON Pointer format (`"#/definitions/stepId"`) and
validate schema files are valid JSON.

---

## 3. Runtime Errors

### 3.1 Rate limit / API errors

**Symptom**: Messages containing `rate limit`, `429`, `Too many requests`, or
`You've hit your limit`.

**Cause**: The Anthropic API rate limit has been reached.

**Resolution**:

The runner detects rate-limit errors (category: `API`, code: `AGENT_RATE_LIMIT`)
and retries automatically with exponential backoff:

- Base delay: 5 000 ms
- Maximum delay: 60 000 ms
- Formula: `min(5000 * 2^attempt, 60000)`

If retries are exhausted, wait a few minutes and re-run.

**Prevention**: Use `--iterate-max` to limit total iterations and avoid
excessive API usage.

---

### 3.2 Sandbox restrictions

**Symptom**: `Cannot execute SDK query() in double sandbox environment` or
`Claude Code process exited with code 1`.

**Cause**: Running the agent inside Claude Code's Bash tool creates a
double-sandbox situation. The outer sandbox blocks network access before the
inner SDK sandbox can reach the API.

**Resolution**:

1. Run from an external terminal:
   ```bash
   deno task agent --agent iterator --issue 123
   ```
2. Or disable the outer sandbox:
   ```typescript
   Bash({
     command: "deno task agent --agent iterator --issue 123",
     dangerouslyDisableSandbox: true,
   });
   ```

The environment checker (`environment-checker.ts`) detects this situation and
reports:

- `insideClaudeCode`: whether `CLAUDE_CODE=1` or `CLAUDE_SESSION_ID` is set
- `sandboxed`: whether `SANDBOX_ENABLED=true` or `SANDBOX_ID` is set
- `nestLevel`: parsed from `CLAUDE_NEST_LEVEL` (warning at level > 1)

**Prevention**: Prefer terminal execution for agent runs.

> **Differential diagnosis**: If other agents succeed in the same environment,
> the cause is not sandbox restrictions. Check
> [3.4 permissionMode mismatch](#34-permissionmode-mismatch) instead.

---

### 3.3 Tool permission errors

**Symptom**: The agent attempts to use a tool but receives a permission denial,
or silently skips expected actions.

**Cause**: `allowedTools` in `config.json` or `steps_registry.json` does not
include the required tool, or `permissionMode` is too restrictive.

**Resolution**:

1. Check `allowedTools` in your configuration:
   ```json
   {
     "agents": {
       "climpt": {
         "allowedTools": [
           "Skill",
           "Read",
           "Write",
           "Edit",
           "Bash",
           "Glob",
           "Grep"
         ],
         "permissionMode": "acceptEdits"
       }
     }
   }
   ```
2. Note that `filterAllowedTools()` automatically removes boundary tools (e.g.,
   `githubIssueClose`) during work/verification steps. This is intentional.

**Prevention**: Declare all needed tools explicitly in `allowedTools` and use
`acceptEdits` for normal operation.

---

### 3.4 permissionMode mismatch

**Symptom**: `Claude Code process exited with code 1`, but other agents run
successfully in the same environment.

**Cause**: The agent's `permissionMode` is set to `bypassPermissions`, which
requires the `--dangerously-skip-permissions` CLI flag when launching Claude
Code. Without this flag, Claude Code exits immediately with code 1.

This error is often misdiagnosed as a sandbox issue because the error message is
identical. The key differentiator is whether **other agents succeed** — if they
do, the environment is fine and the problem is agent-specific configuration.

**Resolution**:

1. Check the agent's `permissionMode` setting:
   ```bash
   cat .agent/<name>/agent.json | jq '.runner.boundaries.permissionMode'
   ```
2. If it returns `"bypassPermissions"`, either:
   - Change to `"acceptEdits"` (recommended for interactive use):
     ```json
     {
       "runner": {
         "boundaries": {
           "permissionMode": "acceptEdits"
         }
       }
     }
     ```
   - Or ensure the CLI flag is provided when running the agent (for
     CI/unattended use only).

**Comparison**:

| Agent A (works) | Agent B (fails)     | Diagnosis            |
| --------------- | ------------------- | -------------------- |
| `acceptEdits`   | `bypassPermissions` | permissionMode issue |
| `acceptEdits`   | `acceptEdits`       | Not this issue       |

**Error chain**: When this occurs, the runner may also report
`[StepFlow] No intent produced` — this is a secondary error caused by the
process crash, not a schema configuration problem.

**Prevention**: Use `bypassPermissions` only in CI/unattended environments where
the required CLI flags are guaranteed. Use `acceptEdits` for interactive
development.

---

## 4. Agent-Specific Errors

### 4.1 Empty output from breakdown CLI

**Symptom**: Agent log shows `Empty output from breakdown CLI` or the prompt
loader returns no content.

**Cause**: The C3L prompt file does not exist at the expected path, or the
`@tettuan/breakdown` CLI returned an empty result.

**Resolution**:

1. Re-run initialization to regenerate prompt templates:
   ```bash
   deno run -A jsr:@aidevtool/climpt/agents/iterator --init
   ```
2. Verify prompt files exist:
   ```bash
   ls .agent/iterator/prompts/dev/
   ```

**Prevention**: Run `--init` whenever you change agent definitions or update
Climpt versions.

---

### 4.2 Step routing errors

**Symptom**: `AgentStepRoutingError` (code: `FAILED_STEP_ROUTING`) or
`GateInterpretationError` (code: `GATE_INTERPRETATION_ERROR`).

**Cause**: `StepGateInterpreter` could not determine an intent from the
structured output. This usually means the LLM response did not match any defined
transition.

**Resolution**:

1. Verify `transitions` in `steps_registry.json` cover all possible intents:
   ```bash
   cat .agent/<name>/steps_registry.json | jq '.steps[].transitions'
   ```
2. Ensure `outputSchemaRef` is correctly configured (structured output is
   required for intent routing).
3. Check for `AgentStepIdMismatchError` (code: `AGENT_STEP_ID_MISMATCH`) -- the
   schema may be missing a `"const"` constraint on the `stepId` field.

**Prevention**: Always define `outputSchemaRef` with a `const` constraint for
`stepId`, and cover all expected intents in `transitions`.

---

### 4.3 Verdict / completion failures

**Symptom**: `AgentMaxIterationsError` with message
`Maximum iterations (N) reached without finishing`, or the agent runs
indefinitely.

**Cause**: The verdict condition is never satisfied.

**Resolution** by verdict type:

| Verdict Type      | Common Cause                        | Fix                                                |
| ----------------- | ----------------------------------- | -------------------------------------------------- |
| `detect:keyword`  | Keyword not present in agent output | Verify `verdictKeyword` in `runner.verdict.config` |
| `count:iteration` | `maxIterations` too low             | Increase `maxIterations`                           |
| `poll:state`      | Issue state unchanged               | Check `gh issue view <num> --json state`           |
| `detect:graph`    | Step never reaches terminal state   | Review `transitions` in `steps_registry.json`      |

**Prevention**: Always set `--iterate-max` as a safety cap, even when using
other verdict types.

---

### 4.4 C3L Prompt File Not Found

**Error**:

```
[PATH] C3L prompt file not found: steps["initial.default"] → "prompts/steps/initial/default/f_default.md" does not exist
```

**Cause**: The C3L prompt file referenced by a step in `steps_registry.json`
does not exist at the expected path. The `--validate` flow checks every step's
C3L prompt file and reports an error for each missing file.

**Fix**:

1. Read the error message to identify the step ID and expected path
2. Create the missing prompt file at the indicated path:
   ```bash
   mkdir -p .agent/<name>/prompts/steps/initial/default
   touch .agent/<name>/prompts/steps/initial/default/f_default.md
   ```
3. Alternatively, re-run initialization to regenerate all prompt templates:
   ```bash
   deno run -A jsr:@aidevtool/climpt/agents/iterator --init
   ```

**Verification**:

```bash
deno task agent --agent <name> --validate
```

---

### 4.5 Initialization and worktree errors

**Symptom**: `AgentNotInitializedError` (code: `AGENT_NOT_INITIALIZED`) or
worktree setup failures.

**Cause**: `AgentRunner` was used before calling initialization, or
`setupWorktree` failed due to branch-name collisions or directory conflicts.

**Resolution**:

1. For initialization errors, ensure `--init` has been run:
   ```bash
   deno run -A jsr:@aidevtool/climpt/agents/iterator --init
   ```
2. For worktree errors, check for existing branches with the same name:
   ```bash
   git branch -a | grep <worktree-branch-name>
   ```
3. Remove stale worktree directories:
   ```bash
   git worktree list
   git worktree remove <path>
   ```

**Prevention**: Use unique branch names for each agent session and clean up
stale worktrees regularly.

---

### 4.6 UV Reachability Errors

**Symptom**: `--validate` reports "UV variable has no identified supply source"

**Cause**: A step declares a UV variable in `uvVariables` but no supply channel
provides it.

**Supply channels**:

- Channel 1: CLI parameters declared in `agent.json` `parameters`
- Channel 2: Runner runtime variables (iteration, completed_iterations)
- Channel 3: VerdictHandler variables (max_iterations, remaining,
  previous_summary)
- Channel 4: Step handoff via `inputs` definitions

**Resolution**:

1. Check `uvVariables` array in `steps_registry.json` for the failing step
2. If the variable should come from CLI: add it to `agent.json` `parameters`
3. If it's a runtime variable: verify it's in `RUNTIME_SUPPLIED_UV_VARS`
4. If it comes from a previous step: add an `inputs` definition with the source
   step
5. Run `--validate` again to confirm the fix

---

## Error Code Reference

| Error Code        | Description                      | Guide                                                                     |
| ----------------- | -------------------------------- | ------------------------------------------------------------------------- |
| PR-C3L-004        | Prompt file not found            | Section above: [C3L Prompt File Not Found](#44-c3l-prompt-file-not-found) |
| PR-RESOLVE-003    | UV variable undefined at runtime | See: [UV Reachability Errors](#46-uv-reachability-errors)                 |
| PR-RESOLVE-005    | UV variable not provided         | Check Channel 1 parameters                                                |
| Validation failed | --validate found issues          | Run `--validate` and check each category below                            |

---

## 5. Debugging Techniques

### 5.1 --verbose flag

Enable verbose output to see detailed execution information:

```bash
deno task agent --agent iterator --issue 123 --verbose
```

Verbose output includes:

- Step transitions and intent routing decisions
- Prompt loading results (success or failure)
- Verdict evaluation at each iteration
- Environment detection results

---

### 5.2 --validate flag

Check configuration for structural errors without running the agent:

```bash
deno task agent --agent my-agent --validate
```

The `--validate` flag checks configuration files, schema references, and C3L
prompt file existence for every step defined in `steps_registry.json`.

Example output for a valid configuration:

```
agent.json: OK
steps_registry.json: OK
Prompt files: 4/4 found
Schema files: 2/2 valid
```

Example output with errors:

```
agent.json: ERROR - Unknown key "runner.completion" (did you mean "runner.verdict"?)
steps_registry.json: WARNING - Step "plan" missing "stepKind" field
[PATH] C3L prompt file not found: steps["initial.default"] → "prompts/steps/initial/default/f_default.md" does not exist
```

See [4.4 C3L prompt file not found](#44-c3l-prompt-file-not-found) for
resolution steps.

---

### 5.3 Reading log files

Logs are saved in JSONL format under the logging directory:

```
tmp/logs/agents/<agent-name>/session-<timestamp>.jsonl
```

Useful `jq` queries:

```bash
# Show all log levels and messages
cat tmp/logs/agents/iterator/*.jsonl | jq '{level: .level, message: .message}'

# Extract errors only
cat tmp/logs/agents/iterator/*.jsonl | jq 'select(.level == "error")'

# Show error codes and guidance
cat tmp/logs/agents/iterator/*.jsonl | jq 'select(.level == "error") | {code: .data.code, message: .data.message, guidance: .data.guidance}'

# Track step transitions
cat tmp/logs/agents/iterator/*.jsonl | jq 'select(.message | test("step|transition"; "i"))'

# Check schema resolution status
cat tmp/logs/agents/iterator/*.jsonl | jq 'select(.message | test("schema|outputSchemaRef"; "i"))'
```

---

### 5.4 Diagnostic commands

Run these commands to gather environment information for troubleshooting:

```bash
# Deno version and cache info
deno --version
deno info

# GitHub CLI status
gh auth status
gh api /user --jq '.login'

# Git repository status
git status
git remote -v

# Verify agent configuration files
ls -la .agent/*/agent.json
ls -la .agent/*/steps_registry.json

# Check for double sandbox indicators
echo "CLAUDE_CODE=$CLAUDE_CODE"
echo "SANDBOX_ENABLED=$SANDBOX_ENABLED"
echo "CLAUDE_NEST_LEVEL=$CLAUDE_NEST_LEVEL"
```

---

## Error Class Reference

All errors extend `ClimptError` (alias: `AgentError`). Each error provides
`code`, `recoverable`, and `toJSON()` for structured logging.

| Error Class                      | Code                          | Recoverable | Category    |
| -------------------------------- | ----------------------------- | ----------- | ----------- |
| `AgentNotInitializedError`       | `AGENT_NOT_INITIALIZED`       | No          | Runner      |
| `AgentQueryError`                | `AGENT_QUERY_ERROR`           | Yes         | Runner      |
| `AgentVerdictError`              | `AGENT_VERDICT_ERROR`         | Yes         | Runner      |
| `AgentTimeoutError`              | `AGENT_TIMEOUT`               | Yes         | Runner      |
| `AgentMaxIterationsError`        | `AGENT_MAX_ITERATIONS`        | No          | Runner      |
| `AgentRetryableQueryError`       | `AGENT_RETRYABLE_QUERY_ERROR` | Yes         | Runner      |
| `AgentSchemaResolutionError`     | `FAILED_SCHEMA_RESOLUTION`    | No          | Flow        |
| `AgentStepIdMismatchError`       | `AGENT_STEP_ID_MISMATCH`      | No          | Flow        |
| `AgentStepRoutingError`          | `FAILED_STEP_ROUTING`         | No          | Flow        |
| `GateInterpretationError`        | `GATE_INTERPRETATION_ERROR`   | No          | Flow        |
| `RoutingError`                   | `ROUTING_ERROR`               | No          | Flow        |
| `SchemaPointerError`             | `SCHEMA_POINTER_ERROR`        | No          | Flow        |
| `MalformedSchemaIdentifierError` | `MALFORMED_SCHEMA_IDENTIFIER` | No          | Flow        |
| `AgentEnvironmentError`          | `AGENT_ENVIRONMENT_ERROR`     | No          | Environment |
| `AgentRateLimitError`            | `AGENT_RATE_LIMIT`            | Yes         | Environment |
| `ConfigError (AC-LOAD-*)`        | `AC-LOAD-001..003`            | No          | Environment |
| `ConfigError (PR-FILE-001)`      | `PR-FILE-001`                 | No          | Environment |

---

## Related Documentation

- [01-prerequisites.md](./01-prerequisites.md) -- Deno and gh CLI setup
- [02-climpt-setup.md](./02-climpt-setup.md) -- Climpt initialization
- [04-iterate-agent-setup.md](./04-iterate-agent-setup.md) -- Agent execution
- [09-migration-guide.md](./09-migration-guide.md) -- Configuration migration

---

## Support

If you encounter an issue not covered here, please create an Issue:
https://github.com/tettuan/climpt/issues
