# Climpt Examples

Practical examples for [Climpt](https://jsr.io/@aidevtool/climpt) (CLI +
Prompt).

## Progressive Pipeline

Examples are **numbered 01–55** and designed to run in order. Each step builds
on the state created by previous steps (steps 54-55 are state-independent):

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
21-24   Agent E2E      run, verify, contract, save → plan-mode tested (LLM required)
  ↓
25-27   Agent Contract resolution, schema, intent  → contracts verified (local)
  ↓
28-32   Iterator       init, configure, verify,    → .agent/iterator/ built + run (LLM)
                       run, schema
  ↓
33-37   Reviewer       init, configure, verify,    → .agent/reviewer/ built + run (LLM)
                       run, schema
  ↓
38-41   Analyzer       init, configure, verify,    → .agent/analyzer/ built + run (LLM)
                       run
  ↓
42-43   Contracts      negative load, tool policy  → error handling verified
  ↓
44-46   Registry       generate, verify, structure → registry.json updated
  ↓
47-48   MCP            server, config              → MCP ready
  ↓
49-52   Workflow       config, resolution,         → workflow CLI E2E verified (--local mode)
                       transition, batch
  ↓
53      Clean          reset all artifacts         → clean state
  ↓
54      Handoff E2E    StepContext data path        → namespace + collision verified
  ↓
55      Loop Analysis  dual-loop log boundaries    → FlowLoop + CompletionLoop paired
```

The `outputs/` directory accumulates artifacts as examples progress. Each script
can read previous outputs and write new ones.

**Key principle (steps 16–24):** The process of constructing plan-scout (init,
configure, run) is itself an example. The plan-scout agent definition is not a
pre-built file — it is created by running steps 16–20.

**Key principle (steps 28–41):** Iterator, reviewer, and analyzer agents are
also built from scratch within examples/ using the same init → configure →
verify → run pattern. No symlinks to REPO_ROOT/.agent/ are used.

> **Note:** Steps 32/37 verify the committed core agents (`.agent/iterator` and
> `.agent/reviewer`), which are tracked in version control and do not require
> prior example steps to exist.

## Step Categories

Steps fall into two distinct categories based on how they execute:

### E2E Steps (User Behavior Emulation)

Steps **01-24, 28-31, 33-36, 38-41, 44, 46-53** exercise the CLI and file system
exactly as a real user would: running shell commands, reading/writing files, and
invoking `climpt` or `deno task agent` from the command line.

### Contract Verification Steps (Internal Contract Tests)

Steps **25-27, 32, 37, 42-43, 45, 54-55** validate internal contracts by
importing TypeScript modules directly (e.g., `deno run` on `.ts` scripts that
import resolvers, factories, or schema validators). They test invariants such
as:

- Prompt resolution (step 25)
- Schema fail-fast behavior (step 26)
- Intent routing (step 27)
- JSON schema structure (steps 32, 37)
- Negative agent load / tool policy (steps 42-43)
- Factory completion path coverage (step 45)
- Handoff data path and collision prevention (step 54)
- Dual-loop log boundary pairing (step 55)

These steps are **not representative of user workflows**. They exist to verify
that internal modules uphold their contracts (correct errors on invalid input,
correct resolution on valid input, correct policy enforcement). They require
only local Deno execution and no LLM access.

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
- `ANTHROPIC_API_KEY` environment variable — for steps 21-22, 24, 31, 36, 41

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
> for f in examples/[0-9][0-9]_*/run.sh; do bash "$f"; done
> ```

## Execution Tiers

Each step belongs to one of three tiers. All tiers must pass for E2E
verification to be complete.

| Tier    | Requirement                           | Steps                                            |
| ------- | ------------------------------------- | ------------------------------------------------ |
| Local   | Deno + jq                             | 01, 03-09, 13-20, 23, 25-30, 32-35, 37-40, 42-55 |
| Network | `jsr.io` reachable (HTTPS)            | 02, 10-12                                        |
| LLM     | `api.anthropic.com` reachable (HTTPS) | 21-22, 24, 31, 36, 41                            |

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
bash examples/23_*/run.sh
for f in examples/{25,26,27,28,29,30}_*/run.sh; do bash "$f"; done
for f in examples/{32,33,34,35}_*/run.sh; do bash "$f"; done
for f in examples/{37,38,39,40}_*/run.sh; do bash "$f"; done
for f in examples/{42,43,44,45,46,47,48,49,50,51,52,53,54,55}_*/run.sh; do bash "$f"; done

# 2. Network tier (requires jsr.io)
bash examples/02_install/run.sh
for f in examples/{10,11,12}_*/run.sh; do bash "$f"; done

# 3. LLM tier (requires ANTHROPIC_API_KEY)
for f in examples/{21,22,24}_*/run.sh; do bash "$f"; done
for f in examples/{31,36,41}_*/run.sh; do bash "$f"; done
```

> **Warning: Nested Claude Code execution is not supported.** Examples 21-22,
> 24, 31, 36, 41 invoke `deno task agent` which internally spawns a Claude Code
> process. If you run these examples from within a Claude Code session (e.g.,
> via the Bash tool), the nested Claude Code process will fail. Always delegate
> example execution to a **sub-agent** or run from an external terminal.

## Directory Structure

| #  | Folder                            | Description                                      | State In             | State Out                     | Verifies                                           |
| -- | --------------------------------- | ------------------------------------------------ | -------------------- | ----------------------------- | -------------------------------------------------- |
| 01 | 01_check_prerequisites/           | Check deno, jq                                   | —                    | —                             |                                                    |
| 02 | 02_install/                       | Install Climpt from JSR                          | —                    | `climpt` on PATH              |                                                    |
| 03 | 03_init/                          | Initialize project (`climpt init`)               | —                    | `.agent/climpt/`              |                                                    |
| 04 | 04_verify_init/                   | Verify init result and show options              | `.agent/climpt/`     | —                             | config/ and prompts/ dirs exist                    |
| 05 | 05_echo_test/                     | Simplest CLI invocation (echo)                   | `.agent/climpt/`     | —                             |                                                    |
| 06 | 06_stdin_input/                   | STDIN piping patterns                            | `.agent/climpt/`     | —                             |                                                    |
| 07 | 07_custom_variables/              | User-defined variables (`--uv-*`)                | `.agent/climpt/`     | —                             | --uv-target content; echo contains input string    |
| 08 | 08_meta_commands/                 | Meta domain commands                             | `.agent/climpt/`     | —                             | naming pattern; YAML delimiter; content markers    |
| 09 | 09_git_commands/                  | Git domain commands                              | `.agent/climpt/`     | —                             | branch-related content in output                   |
| 10 | 10_docs_list/                     | List available documentation                     | —                    | —                             |                                                    |
| 11 | 11_docs_install/                  | Install documentation files                      | —                    | `docs/`                       |                                                    |
| 12 | 12_docs_filter/                   | Filter docs by category/language/mode            | —                    | —                             | category, lang, flatten, single produce files      |
| 13 | 13_list_agents/                   | List available agents                            | —                    | —                             | deno tasks; agent.json configs; runner script      |
| 14 | 14_show_agent_schema/             | Show agent.json schema                           | —                    | —                             | valid JSON; contains "runner" property             |
| 15 | 15_show_agent_config/             | Show agent configuration structure               | —                    | —                             | dynamic layout; schema required/properties         |
| 16 | 16_init_agent/                    | Initialize plan-scout agent                      | —                    | `.agent/plan-scout/`          |                                                    |
| 17 | 17_show_init_result/              | Show agent init result                           | `.agent/plan-scout/` | —                             | .runner, permissionMode, allowedTools validated    |
| 18 | 18_configure_permission/          | Set permissionMode to "plan"                     | `.agent/plan-scout/` | `.agent/plan-scout/` patched  |                                                    |
| 19 | 19_configure_prompt/              | Write custom system.md                           | `.agent/plan-scout/` | `.agent/plan-scout/` patched  |                                                    |
| 20 | 20_show_final_config/             | Show final agent config                          | `.agent/plan-scout/` | —                             |                                                    |
| 21 | 21_run_plan_agent/                | Run plan-scout agent (LLM required)              | `.agent/plan-scout/` | sentinel                      | LLM evidence in output; check_llm_ready gate       |
| 22 | 22_verify_plan_mode/              | Verify plan mode enforcement                     | sentinel             | `outputs/agents/`             | sentinel absence proves Write was blocked          |
| 23 | 23_verify_plan_mode_contract/     | Plan mode config contracts (no LLM)              | `.agent/plan-scout/` | —                             | permissionMode=plan; Write in tools; not step flow |
| 24 | 24_save_results/                  | Save agent logs and cleanup                      | `.agent/plan-scout/` | `outputs/agents/`             |                                                    |
| 25 | 25_prompt_resolution/             | Prompt file presence affects behavior            | —                    | —                             | real resolver for all 4 scenarios                  |
| 26 | 26_schema_fail_fast/              | Schema fail-fast contract                        | —                    | —                             | invalid pointer throws; valid resolves             |
| 27 | 27_intent_routing/                | Intent routing contract                          | —                    | —                             | transitions target exists; intents match           |
| 28 | 28_init_iterator/                 | Initialize iterator agent                        | —                    | `.agent/iterator/`            |                                                    |
| 29 | 29_configure_iterator/            | Configure iterator (verdict, params, prompts)    | `.agent/iterator/`   | `.agent/iterator/` configured |                                                    |
| 30 | 30_verify_iterator_config/        | Verify iterator build result                     | `.agent/iterator/`   | —                             | verdict, params, worktree, prompts, config         |
| 31 | 31_run_iterator/                  | Run iterator agent (LLM required)                | `.agent/iterator/`   | —                             | contract validation + LLM execution evidence       |
| 32 | 32_verify_iterator_schema/        | Verify iterator JSON schema (4-level)            | —                    | —                             | file existence, $ref, structure, gate intent       |
| 33 | 33_init_reviewer/                 | Initialize reviewer agent                        | —                    | `.agent/reviewer/`            |                                                    |
| 34 | 34_configure_reviewer/            | Configure reviewer (verdict, params, prompts)    | `.agent/reviewer/`   | `.agent/reviewer/` configured |                                                    |
| 35 | 35_verify_reviewer_config/        | Verify reviewer build result                     | `.agent/reviewer/`   | —                             | verdict, params, worktree, prompts, config         |
| 36 | 36_run_reviewer/                  | Run reviewer agent (LLM required)                | `.agent/reviewer/`   | —                             | contract validation + LLM execution evidence       |
| 37 | 37_verify_reviewer_schema/        | Verify reviewer JSON schema (4-level)            | —                    | —                             | file existence, $ref, structure, gate intent       |
| 38 | 38_init_analyzer/                 | Initialize analyzer agent                        | —                    | `.agent/analyzer/`            |                                                    |
| 39 | 39_configure_analyzer/            | Configure analyzer (verdict, params, prompts)    | `.agent/analyzer/`   | `.agent/analyzer/` configured |                                                    |
| 40 | 40_verify_analyzer_config/        | Verify analyzer build result                     | `.agent/analyzer/`   | —                             | verdict, params, worktree, prompts, config         |
| 41 | 41_run_analyzer/                  | Run analyzer agent (LLM required)                | `.agent/analyzer/`   | —                             | contract validation + LLM execution evidence       |
| 42 | 42_negative_agent_load/           | Negative agent load contract                     | —                    | —                             | bad path/JSON/schema → proper errors               |
| 43 | 43_stepkind_tool_policy/          | StepKind tool policy contract                    | —                    | —                             | work/verify deny boundary; closure allows          |
| 44 | 44_generate_registry/             | Generate registry.json                           | `.agent/climpt/`     | `registry.json`               |                                                    |
| 45 | 45_verify_factory_completionpath/ | Verify factory completion path                   | —                    | —                             | completion path coverage verified                  |
| 46 | 46_show_registry_structure/       | Explain registry format                          | `.agent/climpt/`     | —                             |                                                    |
| 47 | 47_mcp_start_server/              | Start MCP server                                 | —                    | MCP running                   | package resolves; server starts without crash      |
| 48 | 48_mcp_show_config/               | MCP integration config guide                     | —                    | —                             |                                                    |
| 49 | 49_workflow_config/               | Workflow config validation (CLI E2E, --local)    | —                    | —                             | valid/invalid config, exit codes, JSON output      |
| 50 | 50_workflow_resolution/           | Label → phase resolution (CLI E2E, --local)      | —                    | —                             | ready/done/blocked/unknown → correct status        |
| 51 | 51_workflow_transition/           | Phase transition via file I/O (CLI E2E, --local) | —                    | —                             | label changes in meta.json after transitions       |
| 52 | 52_workflow_batch/                | Batch processing (CLI E2E, --local)              | —                    | —                             | processed/skipped counts, file system changes      |
| 54 | 54_handoff_e2e/                   | Handoff E2E data path verification               | —                    | —                             | StepContext toUV namespace, collision prevention   |
| 55 | 55_dualloop_log_analysis/         | Dual-loop log boundary analysis                  | —                    | —                             | FlowLoop + CompletionLoop marker pairing, sequence |
| 99 | 99_clean/                         | Cleanup all artifacts                            | all of the above     | —                             |                                                    |

## How to Run

### 推奨: run-all (別ターミナルで実行 + Claude Code で監視)

Claude Code 内からの直接実行は `CLAUDECODE=1` 環境変数の継承により LLM
ステップが失敗する。別ターミナルから `run-all.sh` を実行し、Claude Code の
sub-agent でログを監視する。

#### 1. 別ターミナルで実行

```bash
# フォアグラウンド (ターミナルを開いたまま)
bash examples/run-all.sh

# バックグラウンド (ターミナルを閉じても継続)
nohup bash examples/run-all.sh > /dev/null 2>&1 &
```

#### 2. Claude Code でログ監視を依頼

実行開始後、Claude Code に以下のように指示する:

> examples の run-all ログを sub-agent で監視して

Claude Code は background sub-agent を起動し、`tmp/logs/examples/` 配下の
`summary.json` の出現を監視する。完了後、PASS/FAIL 結果と FAIL ステップの
ログ抜粋を報告する。メインのコンテキストを消費しない。

#### ログと結果分析

```bash
# 最新の summary.json を確認
ls -t tmp/logs/examples/*/summary.json | head -1 | xargs cat

# FAIL したステップのログを確認
cat tmp/logs/examples/{datetime}/{step_name}.log
```

`summary.json` に全ステップの exit_code と PASS/FAIL が記録される。

### 手動実行 (個別ステップ)

```bash
# Run a single example
bash examples/05_echo_test/run.sh

# Run all examples in order (from terminal, NOT from Claude Code)
for f in examples/[0-9][0-9]_*/run.sh; do
  bash "$f"
done

# Run the E2E agent pipeline (steps 16-24)
for f in examples/{16,17,18,19,20,21,22,23,24}_*/run.sh; do
  bash "$f"
done

# Run schema verification (optional, no LLM required)
for f in examples/{32,37,45}_*/run.sh; do bash "$f"; done

# Clean up afterwards
bash examples/99_clean/run.sh
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
├── agents/       # Agent run logs and results (22, 24)
├── cli/          # CLI command outputs
├── mcp/          # MCP config snapshots
└── registry/     # Generated registry snapshots
```

This directory is removed by `99_clean/run.sh`.
