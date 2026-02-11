# Climpt Examples

Practical examples for [Climpt](https://jsr.io/@aidevtool/climpt) (CLI +
Prompt).

## Prerequisites

- [Deno 2.x](https://deno.land/) installed
- Run `deno install` in the project root (for local development)

## Directory Structure

| Folder                           | Description                                   |
| -------------------------------- | --------------------------------------------- |
| [01_setup/](./01_setup/)         | Installation and initialization               |
| [02_cli_basic/](./02_cli_basic/) | Core CLI commands: decompose, summary, defect |
| [03_mcp/](./03_mcp/)             | MCP server setup and IDE integration          |
| [04_docs/](./04_docs/)           | Documentation installer                       |
| [05_agents/](./05_agents/)       | Agent framework (iterator, reviewer)          |
| [06_registry/](./06_registry/)   | Registry generation and structure             |
| [07_clean.sh](./07_clean.sh)     | Cleanup generated files                       |

## How to Run

```bash
# Make scripts executable
chmod +x examples/**/*.sh examples/*.sh

# Run a single example
./examples/01_setup/01_install.sh

# Clean up afterwards
./examples/07_clean.sh
```

## Shared Functions

All scripts source `common_functions.sh` which provides:

- `check_deno` / `check_climpt_init` -- prerequisite checks
- `info` / `success` / `error` / `warn` -- colored output
- `run_example` -- show-then-run a command
- `CLIMPT_DIR` -- path to `.agent/climpt`
