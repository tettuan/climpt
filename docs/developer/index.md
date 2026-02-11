# Developer Documentation

This section is for developers who want to build agents, extend Climpt, or
contribute to the project.

## Agent Development

### Building Custom Agents

- [Quick Start Guide](../../agents/docs/builder/01_quickstart.md) - Get started
  building agents
- [Agent Definition Reference](../../agents/docs/builder/02_agent_definition.md) -
  Complete agent.json field reference
- [Builder Guide](../../agents/docs/builder/03_builder_guide.md) - Comprehensive
  guide for agent creation
- [Configuration System](../../agents/docs/builder/04_config_system.md) - How
  agent configuration works
- [Troubleshooting](../../agents/docs/builder/05_troubleshooting.md) - Common
  issues and solutions

### Migration

- [Migration Guide](../../agents/docs/builder/migration_guide.md) - Upgrading
  from older versions
- [Migration Incompatibilities](../../agents/docs/builder/migration_incompatibilities.md) -
  Breaking changes reference

## Architecture & Design

- [Runner Architecture](../../agents/docs/design/01_runner.md) - How the agent
  runner works
- [Prompt System](../../agents/docs/design/02_prompt_system.md) - System and
  step prompts design
- [Structured Outputs](../../agents/docs/design/03_structured_outputs.md) -
  Output handling design
- [Design Philosophy](../../agents/docs/design/04_philosophy.md) - Core design
  principles
- [Core Architecture](../../agents/docs/design/05_core_architecture.md) - System
  architecture overview
- [Contracts](../../agents/docs/design/06_contracts.md) - Interface contracts
- [Extension Points](../../agents/docs/design/07_extension_points.md) - How to
  extend the system
- [Step Flow Design](../../agents/docs/design/08_step_flow_design.md) -
  Step-based execution flow

## Plugin Development

- [Plugin Guide](../reference/plugins/plugins.md) - Creating Claude Code plugins
- [Plugin Reference](../reference/plugins/plugins-reference.md) - Plugin API
  reference

## SDK Integration

- [Claude Agent SDK Overview](../reference/claude-agent-sdk-overview.md) - SDK
  overview
- [TypeScript SDK Guide](../reference/claude-agent-sdk-typescript.md) - Detailed
  TypeScript guide
- [Sub-agents](../reference/sub-agents.md) - Working with sub-agents

### SDK Features

- [Cost Tracking](../reference/sdk/cost-tracking.md)
- [Custom Tools](../reference/sdk/custom-tools.md)
- [File Checkpointing](../reference/sdk/file-checkpointing.md)
- [Hooks](../reference/sdk/hooks.md)
- [MCP Integration](../reference/sdk/mcp.md)
- [Permissions](../reference/sdk/permissions.md)
- [Sessions](../reference/sdk/sessions.md)
- [Streaming vs Single Mode](../reference/sdk/streaming-vs-single-mode.md)
- [Structured Outputs](../reference/sdk/structured-outputs.md)
- [Todo Tracking](../reference/sdk/todo-tracking.md)

## Skills Development

- [Skills Overview](../reference/skills/overview.md)
- [Quick Start](../reference/skills/quickstart.md)
- [Agent SDK Skills](../reference/skills/agent-sdk-skills.md)
- [Best Practices](../reference/skills/best-practices.md)

## Internal Specifications

For implementation details and technical specifications, see
[Internal Documentation](../internal/index.md).

## Examples (E2E Verification)

Run [`examples/`](../../examples/) scripts to verify functionality before
releases. **Timing: after `deno task ci` passes, before creating the release
PR.**

| Category                                                | What it verifies                                 |
| ------------------------------------------------------- | ------------------------------------------------ |
| [01-04 Setup](../../examples/01_check_prerequisites/)   | Installation, init, verification                 |
| [05-09 CLI Basic](../../examples/05_echo_test/)         | CLI invocation: echo, meta, git, stdin, `--uv-*` |
| [10-12 Docs](../../examples/10_docs_list/)              | Documentation installer and filtering            |
| [13-23 Agents](../../examples/13_list_agents/)          | Agent init, config, run, E2E verify              |
| [24-26 Agent Run](../../examples/24_prompt_resolution/) | Prompt resolution, iterator, reviewer            |
| [27-28 Registry](../../examples/27_generate_registry/)  | Registry generation and structure                |
| [29-30 MCP](../../examples/29_mcp_start_server/)        | MCP server start and IDE integration             |

See [`examples/README.md`](../../examples/README.md) for prerequisites and run
instructions.

## Quick Links

| Resource                                               | Description                    |
| ------------------------------------------------------ | ------------------------------ |
| [agents/docs/INDEX.md](../../agents/docs/INDEX.md)     | Full agent documentation index |
| [Climpt Agent Integration](../reference/climpt-agent/) | Using Climpt with agents       |
