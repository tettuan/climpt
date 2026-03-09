# Climpt Examples

Practical examples for [Climpt](https://jsr.io/@aidevtool/climpt) (CLI +
Prompt).

## Progressive Pipeline

Examples are **numbered 01–31** and designed to run in order. Each step builds
on the state created by previous steps:

```
01-04   Setup          install, init, verify       → .agent/climpt/ created
  ↓
05-09   CLI Basic      echo, stdin, vars, meta     → uses .agent/climpt/
  ↓
10-12   Docs           list, install, filter       → docs/ installed
  ↓
13-15   Agent Info     list, schema, config        → agents/ explored
  ↓
16-20   Agent Build    init, show, perm, prompt    → .agent/plan-scout/ built
  ↓
21-23   Agent E2E      run, verify, contract, save → plan-mode tested (LLM required)
  ↓
24-26   Agent Contract resolution, schema, routing, → contracts verified (no LLM)
                       negative load, stepKind
  ↓
25-26a  Agent Run      iterator, reviewer,         → agents executed (LLM required)
                       facilitator
  ↓
25v-26v Schema Verify  iterator, reviewer          → schema integrity verified
  ↓
27-28   Registry       generate, structure         → registry.json updated
  ↓
29-30   MCP            server, config              → MCP ready
  ↓
31      Clean          reset all artifacts         → clean state
```

The `outputs/` directory accumulates artifacts as examples progress. Each script
can read previous outputs and write new ones.

**Key principle (steps 16–23):** The process of constructing plan-scout (init,
configure, run) is itself an example. The plan-scout agent definition is not a
pre-built file — it is created by running steps 16–20.

> **Note:** Steps 25v/26v verify the committed core agents (`.agent/iterator`
> and `.agent/reviewer`), which are tracked in version control and do not
> require prior example steps to exist.

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

All steps must be executed. No steps should be skipped.

- [Deno 2.x](https://deno.land/) installed
- Run `deno install` in the project root (for local development)
- `jq` installed (for agent configuration examples)
- Network access to `jsr.io` (HTTPS) — for steps 02, 10-12
- `ANTHROPIC_API_KEY` environment variable — for steps 21-23, 25, 26, 26a

```bash
# Verify all prerequisites before starting
export ANTHROPIC_API_KEY="sk-ant-..."  # required for LLM steps
```

> **Claude Code sandbox restriction:** Steps that access `jsr.io` or
> `api.anthropic.com` fail under the double sandbox of Claude Code's Bash tool.
> Run the full suite from a terminal session directly:
>
> ```bash
> # From terminal (not Claude Code Bash tool)
> for f in examples/[0-3][0-9]_*/run.sh; do bash "$f"; done
> ```

## Execution Tiers

Each step belongs to one of three tiers. All tiers must pass for E2E
verification to be complete.

| Tier    | Requirement                           | Steps                                         |
| ------- | ------------------------------------- | --------------------------------------------- |
| Local   | Deno + jq                             | 01, 03-09, 13-20, 22a, 24-26b, 25v-27v, 27-31 |
| Network | `jsr.io` reachable (HTTPS)            | 02, 10-12                                     |
| LLM     | `api.anthropic.com` reachable (HTTPS) | 21-23, 25, 26, 26a                            |

> **Note:** Step 02 is a sanity check that the JSR-published package installs
> correctly (`deno install -g jsr:@aidevtool/climpt/cli`). Other steps use local
> code via `common_functions.sh` (`CLIMPT_CMD`).

If environment constraints prevent running a specific tier, run the remaining
tiers and record which steps were blocked and why:

```bash
# Run by tier
# 1. Local tier (always runnable)
for f in examples/{01,03,04,05,06,07,08,09}_*/run.sh; do bash "$f"; done
for f in examples/{13,14,15,16,17,18,19,20}_*/run.sh; do bash "$f"; done
for f in examples/22a_*/run.sh; do bash "$f"; done
for f in examples/{24,24a,24b,25a,26b}_*/run.sh; do bash "$f"; done
for f in examples/{25v,26v,27v}_*/run.sh; do bash "$f"; done
for f in examples/{27,28,29,30}_*/run.sh; do bash "$f"; done

# 2. Network tier (requires jsr.io)
bash examples/02_install/run.sh
for f in examples/{10,11,12}_*/run.sh; do bash "$f"; done

# 3. LLM tier (requires ANTHROPIC_API_KEY)
for f in examples/{21,22,23}_*/run.sh; do bash "$f"; done
for f in examples/{25,26,26a}_*/run.sh; do bash "$f"; done
```

## Directory Structure

| #   | Folder                         | Description                           | State In             | State Out                    | Verifies                                           |
| --- | ------------------------------ | ------------------------------------- | -------------------- | ---------------------------- | -------------------------------------------------- |
| 01  | 01_check_prerequisites/        | Check deno, jq                        | —                    | —                            |                                                    |
| 02  | 02_install/                    | Install Climpt from JSR               | —                    | `climpt` on PATH             |                                                    |
| 03  | 03_init/                       | Initialize project (`climpt init`)    | —                    | `.agent/climpt/`             |                                                    |
| 04  | 04_verify_init/                | Verify init result and show options   | `.agent/climpt/`     | —                            | config/ and prompts/ dirs exist                    |
| 05  | 05_echo_test/                  | Simplest CLI invocation (echo)        | `.agent/climpt/`     | —                            |                                                    |
| 06  | 06_stdin_input/                | STDIN piping patterns                 | `.agent/climpt/`     | —                            |                                                    |
| 07  | 07_custom_variables/           | User-defined variables (`--uv-*`)     | `.agent/climpt/`     | —                            | --uv-target content; echo contains input string    |
| 08  | 08_meta_commands/              | Meta domain commands                  | `.agent/climpt/`     | —                            | naming pattern; YAML delimiter; content markers    |
| 09  | 09_git_commands/               | Git domain commands                   | `.agent/climpt/`     | —                            | branch-related content in output                   |
| 10  | 10_docs_list/                  | List available documentation          | —                    | —                            |                                                    |
| 11  | 11_docs_install/               | Install documentation files           | —                    | `docs/`                      |                                                    |
| 12  | 12_docs_filter/                | Filter docs by category/language/mode | —                    | —                            | category, lang, flatten, single produce files      |
| 13  | 13_list_agents/                | List available agents                 | —                    | —                            | deno tasks; agent.json configs; runner script      |
| 14  | 14_show_agent_schema/          | Show agent.json schema                | —                    | —                            | valid JSON; contains "runner" property             |
| 15  | 15_show_agent_config/          | Show agent configuration structure    | —                    | —                            | dynamic layout; schema required/properties         |
| 16  | 16_init_agent/                 | Initialize plan-scout agent           | —                    | `.agent/plan-scout/`         |                                                    |
| 17  | 17_show_init_result/           | Show agent init result                | `.agent/plan-scout/` | —                            | .runner, permissionMode, allowedTools validated    |
| 18  | 18_configure_permission/       | Set permissionMode to "plan"          | `.agent/plan-scout/` | `.agent/plan-scout/` patched |                                                    |
| 19  | 19_configure_prompt/           | Write custom system.md                | `.agent/plan-scout/` | `.agent/plan-scout/` patched |                                                    |
| 20  | 20_show_final_config/          | Show final agent config               | `.agent/plan-scout/` | —                            |                                                    |
| 21  | 21_run_plan_agent/             | Run plan-scout agent (LLM required)   | `.agent/plan-scout/` | sentinel check               | LLM evidence in output; check_llm_ready gate       |
| 22  | 22_verify_plan_mode/           | Verify plan mode enforcement          | sentinel             | `outputs/agents/`            | sentinel absence proves Write was blocked          |
| 22a | 22a_verify_plan_mode_contract/ | Plan mode config contracts (no LLM)   | `.agent/plan-scout/` | —                            | permissionMode=plan; Write in tools; not step flow |
| 23  | 23_save_results/               | Save agent logs and cleanup           | `.agent/plan-scout/` | `outputs/agents/`            |                                                    |
| 24  | 24_prompt_resolution/          | Prompt file presence affects behavior | —                    | —                            | real resolver for all 4 scenarios                  |
| 24a | 24a_schema_fail_fast/          | Schema fail-fast contract             | —                    | —                            | invalid pointer throws; valid resolves             |
| 24b | 24b_intent_routing/            | Intent routing contract               | —                    | —                            | transitions target exists; intents match           |
| 25  | 25_run_iterator/               | Run iterator agent (LLM required)     | `.agent/climpt/`     | —                            | contract validation + LLM execution evidence       |
| 25a | 25a_negative_agent_load/       | Negative agent load contract          | —                    | —                            | bad path/JSON/schema → proper errors               |
| 26  | 26_run_reviewer/               | Run reviewer agent (LLM required)     | `.agent/climpt/`     | —                            | contract validation + LLM execution evidence       |
| 26a | 26a_run_facilitator/           | Run facilitator agent (no --issue)    | `.agent/climpt/`     | —                            | contract validation + LLM execution evidence       |
| 26b | 26b_stepkind_tool_policy/      | StepKind tool policy contract         | —                    | —                            | work/verify deny boundary; closure allows          |
| 25v | 25v_verify_iterator_schema/    | Verify iterator JSON schema (4-level) | —                    | —                            | file existence, $ref, structure, gate intent       |
| 26v | 26v_verify_reviewer_schema/    | Verify reviewer JSON schema (4-level) | —                    | —                            | file existence, $ref, structure, gate intent       |
| 27  | 27_generate_registry/          | Generate registry.json                | `.agent/climpt/`     | `registry.json`              |                                                    |
| 28  | 28_show_registry_structure/    | Explain registry format               | `.agent/climpt/`     | —                            |                                                    |
| 29  | 29_mcp_start_server/           | Start MCP server                      | —                    | MCP running                  | package resolves; server starts without crash      |
| 30  | 30_mcp_show_config/            | MCP integration config guide          | —                    | —                            |                                                    |
| 31  | 31_clean/                      | Cleanup all artifacts                 | all of the above     | —                            |                                                    |

## How to Run

### 推奨: run-all (スケジュール実行)

Claude Code 内からの直接実行は `CLAUDECODE=1` 環境変数の継承により LLM
ステップが失敗する。 `run-all.sh` をターミナルまたは launchd
から実行することで回避する。

```bash
# 1. トリガー (実行リクエスト)
bash examples/trigger.sh
#    → tmp/examples-runner/.trigger に日時が記載される

# 2a. 即時実行 (ターミナルから)
bash examples/run-all.sh

# 2b. launchd 経由 (5分以内に自動実行)
launchctl start com.climpt.run-all
```

#### フラグファイルによる状態管理

| `.trigger` の内容        | 状態      | run-all.sh の動作         |
| ------------------------ | --------- | ------------------------- |
| (ファイルなし)           | idle      | スキップ                  |
| `2026-03-09T12-06-03`    | requested | 実行開始、`started:` 追記 |
| datetime + `started:...` | running   | 二重起動防止、スキップ    |
| (削除済み)               | completed | スキップ                  |

#### ログと結果分析

```bash
# 最新の summary.json を確認
ls -t tmp/logs/examples/*/summary.json | head -1 | xargs cat

# FAIL したステップのログを確認
cat tmp/logs/examples/{datetime}/{step_name}.log
```

`summary.json` に全ステップの exit_code と PASS/FAIL が記録される。

#### launchd 初回セットアップ

```bash
mkdir -p tmp/logs/examples
cp examples/com.climpt.run-all.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.climpt.run-all.plist
```

### 手動実行 (個別ステップ)

```bash
# Run a single example
bash examples/05_echo_test/run.sh

# Run all examples in order (from terminal, NOT from Claude Code)
for f in examples/[0-3][0-9]_*/run.sh; do
  bash "$f"
done

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
