# Agent Builder Guide

Documentation for creating and configuring Climpt agents.

## Getting Started

| Document                                           | Description                                               |
| -------------------------------------------------- | --------------------------------------------------------- |
| [01_quickstart.md](./01_quickstart.md)             | Step-by-step guide to create your first agent             |
| [02_agent_definition.md](./02_agent_definition.md) | agent.json schema and behavior configuration              |
| [03_builder_guide.md](./03_builder_guide.md)       | Design concepts: settings, execution, and prompt chaining |
| [04_config_system.md](./04_config_system.md)       | Configuration layering (CLI > config.json > agent.json)   |

## Migration

If you are migrating from an older agent configuration:

| Document                                                           | Description                  |
| ------------------------------------------------------------------ | ---------------------------- |
| [migration_guide.md](./migration_guide.md)                         | Migration procedures         |
| [migration_incompatibilities.md](./migration_incompatibilities.md) | Breaking changes list        |
| [migration_template.md](./migration_template.md)                   | Template for migration tasks |

## Recommended Reading Order

1. **[01_quickstart.md](./01_quickstart.md)** - Create a working agent first
2. **[02_agent_definition.md](./02_agent_definition.md)** - Understand
   agent.json structure
3. **[03_builder_guide.md](./03_builder_guide.md)** - Learn the design
   philosophy
4. **[04_config_system.md](./04_config_system.md)** - Advanced configuration
   options

## Related Documentation

- [Design Documentation](../design/) - Internal architecture and design
  decisions
- [agents/README.md](../../README.md) - Agent framework overview
