# Agent List

Starting agent testing. Since agents can be created with configuration and
prompts, test according to the following procedure.

## Fail-Fast Rules on Schema Resolution Failure

**Important**: When schema resolution fails, the runner operates according to
these rules:

1. **First failure**: Outputs warning log, skips StepGate as
   `StructuredOutputUnavailable`. Attempts next iteration in the same step.
2. **Two consecutive failures**: Stops immediately with
   `FAILED_SCHEMA_RESOLUTION` error. Prevents infinite loops.

### Log Messages

- `[SchemaResolution] Failed to resolve schema pointer (failure N/2)` - Schema
  pointer resolution failure
- `[SchemaResolution] Marking iteration as StructuredOutputUnavailable` -
  StepGate skip
- `FAILED_SCHEMA_RESOLUTION` - Stopped after 2 consecutive failures

### Common Causes and Solutions

| Cause                                                       | Solution                                                         |
| ----------------------------------------------------------- | ---------------------------------------------------------------- |
| `outputSchemaRef.schema` is bare name (`"initial.default"`) | Change to JSON Pointer format: `"#/definitions/initial.default"` |
| `schemas/step_outputs.schema.json` doesn't exist            | Create schema file                                               |
| `definitions` at pointer target doesn't exist               | Add definition to schema file                                    |

### References

- `agents/docs/builder/01_quickstart.md` - Correct schema configuration format
- `agents/docs/design/08_step_flow_design.md` - Flow step requirements

---

Test Method: Random Testing Test Overview: Randomly select an agent name from
the "Genres" below, then randomly determine a specific work process name from
within the selected genre. This becomes the "agent name". Test Purpose: Confirm
the ease of building and implementing agents with multi-step execution, step
backtracking, and multi-stage flows with nearly 30 steps. (Minimum 5 steps,
maximum 30 steps)

Then follow the "Procedure" below.

## Genres

Random values should be obtained from a new bash execution.

- Housework
- Transportation
- Shopping
- Article Writing
- Software Development
- Bookstore
- Flower Shop
- Entertainment
- Sports Practice
- Accounting
- Public Relations
- Design Contracting
- Randomly select from other fields

## Procedure

1. Build an agent based on the quick guide (without referencing existing
   implementations)

   **Use Skill**: Call `/agent-scaffolder` to generate a template.

   ```
   /agent-scaffolder
   ```

   Reference documents:
   - `agents/docs/builder/01_quickstart.md`
   - `agents/docs/design/08_step_flow_design.md`

- **Must** define `entryStepMapping` or `entryStep`
- Create `.agent/{agent}/schemas/*.schema.json` and set `outputSchemaRef` for
  all Flow/Closure Steps (since schema enforces structured output, JSON format
  notation is unnecessary in prompts)
- **`closing` intent**: Only Closure Steps (`closure.*`) return `closing`. Work
  steps (`initial.*`, `continuation.*`) do not return `closing` 1-1. Determine
  steps according to the agent and create corresponding prompts 1-2. Maintain
  branch as `test/agent-validation` branch 1-3. Commits are unnecessary as the
  branch will eventually be discarded

2. Write the request for the built agent in an issue
3. Create the execution procedure in tmp/tests/{agent-name}/ directory
   hierarchy, noting where logs will be written 4-1. Show execution CLI with gh
   issue number (do not execute) 4-2. Document expected execution results
   (derive predicted results from prompts and issue)

---

Follow the execution procedure and execute from another process (Terminal). This
will be waiting. (You do not execute)

---

Based on the execution report, you monitor the logs. Identify and record issues.
Do not fix.

---

## Execution CLI

```bash
# Agent list
deno run -A agents/scripts/run-agent.ts --list

# Basic execution
deno run -A agents/scripts/run-agent.ts --agent {agent-name} --issue {number}

# With iteration limit
deno run -A agents/scripts/run-agent.ts --agent {agent-name} --issue {number} --iterate-max 10

# Specify branch in worktree mode
deno run -A agents/scripts/run-agent.ts --agent {agent-name} --issue {number} \
  --branch feature/test-{number} --base-branch release/x.x.x
```

### Option List

| Option                 | Description                       |
| ---------------------- | --------------------------------- |
| `--agent, -a <name>`   | Specify agent name (required)     |
| `--issue, -i <number>` | Target GitHub Issue number        |
| `--iterate-max <n>`    | Maximum iterations (default: 100) |
| `--resume`             | Resume previous session           |
| `--branch <name>`      | Branch name for worktree          |
| `--base-branch <name>` | Base branch for worktree          |
| `--no-merge`           | Skip auto-merge after completion  |
| `--push`               | Push to remote after merge        |
| `--create-pr`          | Create PR instead of direct merge |

## Log Monitoring

Logs are output to `tmp/logs/agents/{agent-name}/`.

```bash
# Check latest log files
ls -lt tmp/logs/agents/{agent-name}/ | head -5

# Real-time monitoring
tail -f tmp/logs/agents/{agent-name}/{log-file}.jsonl
```

### Log Format (JSONL)

```json
{"timestamp":"...","level":"info","message":"Agent started","data":{...}}
{"timestamp":"...","level":"debug","message":"SDK message: user"}
{"timestamp":"...","level":"debug","message":"Assistant response","data":{"content":"..."}}
{"timestamp":"...","level":"info","message":"[StepFlow] Interpreted intent: closing","data":{...}}
{"timestamp":"...","level":"info","message":"Agent completed after N iteration(s): ..."}
```

### Recording Issues

- Create directory hierarchy under tmp/tests/{agent-name}/troubles/ and record
  issues as they occur. Document what happened.

Example issues:

- Considering procedures that investigate existing implementations rather than
  only the information provided (insufficient instructions from documentation)
- Returning `closing` intent in work step (insufficient prompt constraints)
- Loop stops due to schema resolution failure (`outputSchemaRef` configuration
  error)

## Intent Mapping

Determines transition from AI's `next_action.action`:

| AI Response | Intent    | Behavior                         |
| ----------- | --------- | -------------------------------- |
| `next`      | `next`    | Go to next Step                  |
| `continue`  | `next`    | Go to next Step                  |
| `repeat`    | `repeat`  | Re-execute same Step             |
| `retry`     | `repeat`  | Re-execute same Step             |
| `closing`   | `closing` | Complete (Closure Step only)     |
| `done`      | `closing` | Complete                         |
| `finished`  | `closing` | Complete                         |
| `complete`  | `closing` | Complete (backward compat alias) |
| `escalate`  | `abort`   | Abort                            |
| `abort`     | `abort`   | Abort                            |

Details: `agents/docs/design/08_step_flow_design.md`

## Step Flow Configuration

```
.agent/{agent-name}/prompts/steps/
├── initial/        # Initial phase (work step)
│   └── {c3}/
│       └── f_default.md
├── continuation/   # Continuation phase (work step)
│   └── {c3}/
│       └── f_default.md
└── closure/        # Completion phase (closure step)
    └── {c3}/
        └── f_default.md
```

### Step Roles

| Phase        | Step ID Example        | Returnable Intents       | Role                              |
| ------------ | ---------------------- | ------------------------ | --------------------------------- |
| initial      | `initial.default`      | `next`, `repeat`, `jump` | Task analysis & planning          |
| continuation | `continuation.default` | `next`, `repeat`, `jump` | Work execution & continuation     |
| closure      | `closure.default`      | `closing`, `repeat`      | Completion confirmation & closing |

**Important**: Work steps (`initial.*`, `continuation.*`) do not return
`closing`. Only Closure Steps (`closure.*`) can declare `closing` to close the
Flow.
