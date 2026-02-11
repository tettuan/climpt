# 02 CLI Basic Usage

Core CLI commands demonstrating echo, meta, git, and input patterns.

## Scripts

| Script                   | Description                                    |
| ------------------------ | ---------------------------------------------- |
| `01_echo_test.sh`        | Simplest CLI invocation: echo stdin back       |
| `02_meta_commands.sh`    | Meta domain: naming, frontmatter, instructions |
| `03_git_commands.sh`     | Git domain: branch decision from task          |
| `04_stdin_input.sh`      | STDIN input patterns (pipe, heredoc, command)  |
| `05_custom_variables.sh` | Pass user-defined variables (`--uv-*`)         |

## CLI Syntax

```bash
deno run -A jsr:@aidevtool/climpt <c2> <c3> --config=<c1> [options]
```

Where:

- `c1` = domain via `--config` (git, meta, test)
- `c2` = action (decide-branch, name, echo, ...)
- `c3` = target (working-branch, c3l-command, input, ...)

## Prerequisites

- Climpt installed and initialized (`climpt init`)
