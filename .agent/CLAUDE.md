# .agent/

The agents in this directory are defined for the Climpt project itself.
They are not part of the published package and are not included in JSR distribution.

## For viewers (users who found this directory)

These agents are project-specific configurations used to develop and test Climpt's agent runner.
They are not default agents, not starter templates, and not intended for reuse in other projects.

To create your own agent, see `agents/docs/builder/01_quickstart.md`.

## For Climpt developers

These agents serve as the primary test targets for the agent runner implementation.
Changes to the runner should be validated against these configurations.

| Agent       | Purpose                              |
|-------------|--------------------------------------|
| iterator    | Development task execution via Issues |
| reviewer    | Code review and verification         |
| facilitator | Project monitoring and coordination  |
| climpt      | MCP command registry and prompts     |

## Operating contexts

When working with `.agent/`, determine which context applies before acting.

| # | Context | What it means | Example |
|---|---------|---------------|---------|
| 1 | Development | Editing repo files (agent.json, prompts, schemas) as source code | Fix a schema field, add a prompt template, update steps_registry |
| 2 | Local execution | Running agents with the local (unreleased) codebase | `deno task agent --agent iterator` to test runner changes |
| 3 | JSR consumer | Using the published package as an end user | `deno run -A jsr:@aidevtool/climpt/agents/runner --agent my-agent` |

Context 1 changes source files. Context 2 exercises them locally. Context 3 does not involve this directory (`.agent/` is excluded from JSR).

When receiving an instruction that involves `.agent/`, identify which context it belongs to before executing.
