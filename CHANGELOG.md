# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.10.8] - 2026-01-24

### Added
- `/update-changelog` skill for CHANGELOG.md maintenance
- `/update-docs` skill for documentation update guidance
- Release procedure checklist with documentation requirements

## [1.10.7] - 2026-01-24

### Added
- Autonomous execution mode with `askUserAutoResponse` config option
- `claude_code` preset for agent execution

### Fixed
- Step Flow implementation aligned with design doc
- `intentSchemaRef` validation and pointer format
- Structured signal fallback templates

## [1.10.6] - 2026-01-18

### Added
- `deno task agent` command for running agents
- `--init` flag for agent scaffold generation
- Boundary Hook for issue close execution (`iterator` agent)
- `PreToolUse` hooks for boundary bash blocking
- stepKind-based tool permission enforcement
- `functional-testing` skill for design-driven testing
- `validateIntentSchemaRef` for fail-fast validation

### Changed
- Removed legacy completionType aliases

### Fixed
- Multi-step agent execution hardening
- Handoff intent alignment for project steps
- Intent values alignment with structuredGate allowedIntents

## [1.10.0] - 2026-01-05

### Added
- Agent framework migration from climpt-agents
- Unified `AgentRunner` engine
- Coordination handoff protocol and validation
- Auto-commit safety net before worktree cleanup (`iterator` agent)

## [1.9.3] - 2025-12-27

### Added
- Iterate Agent: iteration result handoff between sessions with `--resume` option
- Climpt Agent: LLM-based option resolution with intent parameter support

## [1.8.1] - 2025-12-07

### Changed
- Refactored registry generation to use `@aidevtool/frontmatter-to-schema` package
- Standardized all prompt descriptions to English

### Added
- `climpt-meta build frontmatter` command for generating C3L v0.5 compliant frontmatter
- `climpt-meta create instruction` command for creating new instruction files
- Registry generation script (`scripts/generate-registry.ts`)
- Frontmatter-to-schema configuration files

### Removed
- `climpt-code` domain (moved to separate project)

## [1.8.0] - 2025-11-26

### Changed
- **Breaking**: Changed `-i/--input` option to `-e/--edition` (Breakdown 1.6.0 compatibility)
