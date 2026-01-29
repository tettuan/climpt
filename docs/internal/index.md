# Internal Documentation

This section contains technical specifications and design documents for Climpt internals. These documents are intended for contributors and those who need to understand implementation details.

## Core Specifications

### Command System

- [Command Operations](./command-operations.md) - Search, describe, and execute operations specification
  - BM25 search algorithm
  - RRF (Reciprocal Rank Fusion) for multi-query search
  - Execute operation and CLI mapping

- [Registry Specification](./registry-specification.md) - Command registry structure and loading

### Agent System

- [Iterator Agent Design](./iterate-agent-design.md) - Autonomous iteration agent architecture
- [Iterator Agent C3L Integration](./iterate-agent-c3l-integration.md) - How iterator uses C3L commands
- [Worktree Design](./worktree-design.md) - Git worktree management for parallel work

### Architecture

- [Prompt Architecture](./prompt-architecture.md) - System prompt and step prompt design
- [Claude Agent SDK](./claude-agent-sdk.md) - SDK integration patterns

### Philosophy & Testing

- [AI Complexity Philosophy](./ai-complexity-philosophy.md) - Design principles for AI systems
- [Agent Testing](./agent-test.md) - Agent testing strategies and patterns

## Project Guidelines

See [CLAUDE.md](../../CLAUDE.md) at the repository root for:
- Git workflow and branch strategy
- Sandbox restrictions for git/gh commands
- CI/CD procedures
- Release procedures

## Algorithm Quick Reference

### BM25 Search

Used for semantic command search. Key parameters:
- `k1 = 1.2` (term frequency saturation)
- `b = 0.75` (document length normalization)

### RRF (Reciprocal Rank Fusion)

Combines multiple search queries:
- `k = 60` (smoothing parameter)
- Formula: `score(d) = Σ 1/(k + rank_i(d))`

## File Locations

| Component | Location |
|-----------|----------|
| MCP Search Implementation | `src/mcp/similarity.ts` |
| Plugin Search Implementation | `plugins/climpt-agent/lib/similarity.ts` |
| Registry Loading | `src/mcp/registry.ts` |
| Agent Runner | `agents/runner/` |
| Agent Configuration | `agents/config/` |

## Related Documentation

- [Developer Documentation](../developer/index.md) - For building agents and plugins
- [User Documentation](../user/index.md) - For end users
