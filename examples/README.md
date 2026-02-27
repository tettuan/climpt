# Climpt Examples

Practical examples for [Climpt](https://jsr.io/@aidevtool/climpt) (CLI +
Prompt).

## Progressive Pipeline

Examples are **numbered 01–31** and designed to run in order. Each step builds
on the state created by previous steps:

```
01-04  Setup          install, init, verify    → .agent/climpt/ created
  ↓
05-09  CLI Basic      echo, stdin, vars, meta  → uses .agent/climpt/
  ↓
10-12  Docs           list, install, filter    → docs/ installed
  ↓
13-15  Agent Info     list, schema, config     → agents/ explored
  ↓
16-20  Agent Build    init, show, perm, prompt → .agent/plan-scout/ built
  ↓
21-23  Agent E2E      run, verify, save        → plan-mode tested
  ↓
24-26  Agent Run      resolution, iterator,    → agents executed
                      reviewer, facilitator
  ↓
25v-26v Schema Verify  iterator, reviewer       → schema integrity verified
  ↓
27-28  Registry       generate, structure      → registry.json updated
  ↓
29-30  MCP            server, config           → MCP ready
  ↓
31     Clean          reset all artifacts      → clean state
```

The `outputs/` directory accumulates artifacts as examples progress. Each script
can read previous outputs and write new ones.

**Key principle:** The process of constructing an agent (init, configure, run)
is itself an example. Agent definitions are not pre-built files — they are
created by running the example scripts.

## When to Run

These examples serve as **E2E verification** of CLI, MCP, agents, and registry
features:

```
deno task ci (unit tests)
       ↓  pass
examples/ E2E verification   ← HERE
       ↓  pass
PR creation (release/* → develop)
```

## Prerequisites

- [Deno 2.x](https://deno.land/) installed
- Run `deno install` in the project root (for local development)
- `jq` installed (for agent configuration examples)

> **Note:** `ANTHROPIC_API_KEY` is **not required** when running from Claude
> Code that is already authenticated. Claude Code handles API authentication
> internally, so agent examples (21-26) can verify the runner pipeline,
> configuration, and permission enforcement without setting the key separately.

## Directory Structure

| #   | Folder                      | Description                           | State In             | State Out                    | Verifies                                        |
| --- | --------------------------- | ------------------------------------- | -------------------- | ---------------------------- | ----------------------------------------------- |
| 01  | 01_check_prerequisites/     | Check deno, jq                        | —                    | —                            |                                                 |
| 02  | 02_install/                 | Install Climpt from JSR               | —                    | `climpt` on PATH             |                                                 |
| 03  | 03_init/                    | Initialize project (`climpt init`)    | —                    | `.agent/climpt/`             |                                                 |
| 04  | 04_verify_init/             | Verify init result and show options   | `.agent/climpt/`     | —                            | config/ and prompts/ dirs exist                 |
| 05  | 05_echo_test/               | Simplest CLI invocation (echo)        | `.agent/climpt/`     | —                            |                                                 |
| 06  | 06_stdin_input/             | STDIN piping patterns                 | `.agent/climpt/`     | —                            |                                                 |
| 07  | 07_custom_variables/        | User-defined variables (`--uv-*`)     | `.agent/climpt/`     | —                            | --uv-target content; echo contains input string |
| 08  | 08_meta_commands/           | Meta domain commands                  | `.agent/climpt/`     | —                            | naming pattern; YAML delimiter; content markers |
| 09  | 09_git_commands/            | Git domain commands                   | `.agent/climpt/`     | —                            | branch-related content in output                |
| 10  | 10_docs_list/               | List available documentation          | —                    | —                            |                                                 |
| 11  | 11_docs_install/            | Install documentation files           | —                    | `docs/`                      |                                                 |
| 12  | 12_docs_filter/             | Filter docs by category/language/mode | —                    | —                            | category, lang, flatten, single produce files   |
| 13  | 13_list_agents/             | List available agents                 | —                    | —                            | deno tasks; agent.json configs; runner script   |
| 14  | 14_show_agent_schema/       | Show agent.json schema                | —                    | —                            | valid JSON; contains "runner" property          |
| 15  | 15_show_agent_config/       | Show agent configuration structure    | —                    | —                            | dynamic layout; schema required/properties      |
| 16  | 16_init_agent/              | Initialize plan-scout agent           | —                    | `.agent/plan-scout/`         |                                                 |
| 17  | 17_show_init_result/        | Show agent init result                | `.agent/plan-scout/` | —                            |                                                 |
| 18  | 18_configure_permission/    | Set permissionMode to "plan"          | `.agent/plan-scout/` | `.agent/plan-scout/` patched |                                                 |
| 19  | 19_configure_prompt/        | Write custom system.md                | `.agent/plan-scout/` | `.agent/plan-scout/` patched |                                                 |
| 20  | 20_show_final_config/       | Show final agent config               | `.agent/plan-scout/` | —                            |                                                 |
| 21  | 21_run_plan_agent/          | Run plan-scout agent (no API key)     | `.agent/plan-scout/` | sentinel check               |                                                 |
| 22  | 22_verify_plan_mode/        | Verify plan mode enforcement          | sentinel             | `outputs/agents/`            |                                                 |
| 23  | 23_save_results/            | Save agent logs and cleanup           | `.agent/plan-scout/` | `outputs/agents/`            |                                                 |
| 24  | 24_prompt_resolution/       | Prompt file presence affects behavior | —                    | —                            | real resolver for all 4 scenarios               |
| 25  | 25_run_iterator/            | Run iterator agent (no API key)       | `.agent/climpt/`     | —                            | no crash; agent-related output content          |
| 26  | 26_run_reviewer/            | Run reviewer agent (no API key)       | `.agent/climpt/`     | —                            | no crash; agent-related output content          |
| 26a | 26a_run_facilitator/        | Run facilitator agent (no --issue)    | `.agent/climpt/`     | —                            | no crash; agent-related output content          |
| 25v | 25v_verify_iterator_schema/ | Verify iterator JSON schema (4-level) | —                    | —                            | file existence, $ref, structure, gate intent    |
| 26v | 26v_verify_reviewer_schema/ | Verify reviewer JSON schema (4-level) | —                    | —                            | file existence, $ref, structure, gate intent    |
| 27  | 27_generate_registry/       | Generate registry.json                | `.agent/climpt/`     | `registry.json`              |                                                 |
| 28  | 28_show_registry_structure/ | Explain registry format               | `.agent/climpt/`     | —                            |                                                 |
| 29  | 29_mcp_start_server/        | Start MCP server                      | —                    | MCP running                  | package resolves; server starts without crash   |
| 30  | 30_mcp_show_config/         | MCP integration config guide          | —                    | —                            |                                                 |
| 31  | 31_clean/                   | Cleanup all artifacts                 | all of the above     | —                            |                                                 |

## How to Run

```bash
# Run all examples in order
for f in examples/[0-3][0-9]_*/run.sh; do
  bash "$f"
done

# Run a single example
bash examples/05_echo_test/run.sh

# Run the E2E agent pipeline (steps 16-23)
for f in examples/{16,17,18,19,20,21,22,23}_*/run.sh; do
  bash "$f"
done

# Run schema verification (optional, no LLM required)
for f in examples/*v_*/run.sh; do bash "$f"; done

# Clean up afterwards
bash examples/31_clean/run.sh
```

## Shared Functions

All scripts source `common_functions.sh` which provides:

- `check_deno` / `check_climpt_init` — prerequisite checks
- `info` / `success` / `error` / `warn` — colored output
- `run_example` — show-then-run a command
- `CLIMPT_DIR` — path to `.agent/climpt`

## outputs/ Directory

Example scripts write artifacts to `outputs/` for inspection and downstream use:

```
outputs/
├── agents/       # Agent run logs and results (22-23)
├── cli/          # CLI command outputs
├── mcp/          # MCP config snapshots
└── registry/     # Generated registry snapshots
```

This directory is removed by `31_clean/run.sh`.
