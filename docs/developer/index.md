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
releases. Particularly useful for developers:

- [Agent examples](../../examples/05_agents/) - Iterator, reviewer, and config
- [Registry examples](../../examples/06_registry/) - Registry generation

See [`examples/README.md`](../../examples/README.md) for the full list.

## Quick Links

| Resource                                               | Description                    |
| ------------------------------------------------------ | ------------------------------ |
| [agents/docs/INDEX.md](../../agents/docs/INDEX.md)     | Full agent documentation index |
| [Climpt Agent Integration](../reference/climpt-agent/) | Using Climpt with agents       |
