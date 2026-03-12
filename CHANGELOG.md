# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.13.0] - 2026-03-12

### Added
- Getting Started guide with CLI/Agent/MCP/Plugin decision flow (`10-getting-started-guide.md`)
- Runner configuration complete reference (`11-runner-reference.md`)
- Unified troubleshooting guide with error index and debugging techniques (`12-troubleshooting.md`)
- Agent creation tutorial: zero-to-running step-by-step (`13-agent-creation-tutorial.md`)
- Steps registry writing guide with flow design patterns (`14-steps-registry-guide.md`)
- Full JSON Schema validation in `format-validator.ts` (was TODO stub)

### Changed
- `maxIterations` semantics clarified per verdict type: completion threshold for `count:iteration`, safety limit for all others (`agent.schema.json`, `validator.ts`)
- Error messages unified with `[CATEGORY]` prefix, resolution hint, and docs reference (`run-agent.ts`, `validator.ts`, `error-reporter.ts`)

### Changed
- **Breaking**: Verdict type naming changed to `category:variant` pattern — `poll:state`, `count:iteration`, `count:check`, `detect:keyword`, `detect:structured`, `detect:graph`, `meta:composite`, `meta:custom` (was `externalState`, `iterationBudget`, `checkBudget`, `keywordSignal`, `structuredSignal`, `stepMachine`, `composite`, `custom`)
- **Breaking**: agent.json config restructured from flat `behavior`/`prompts`/`logging`/`github`/`worktree` to `runner.*` hierarchy (`runner.flow`, `runner.verdict`, `runner.boundaries`, `runner.execution`, `runner.logging`). See [agent.yaml reference](agents/docs/builder/reference/agent.yaml) for field mapping.
- Renamed Completion identifiers to Verdict/Validation/Closure across all implementation code, design docs, and builder docs
- `VERDICT_CLOSURE_MAP` decouples verdict type names from step IDs in validation-chain

### Removed
- Dead routing code from `StepMachineVerdictHandler` (`transition()`, `getNextStep()`, `recordStepOutput()`, `getStepContext()`, `StepTransition` interface)

### Added
- Schema and registry validator tests
- YAML reference docs (`agent.yaml`, `steps_registry.yaml`) with cross-references
- `--validate` command for agent config validation
- Design docs: concept tree, iteration structure, StepMachine verdict contract, naming rationale

## [1.11.24] - 2026-02-16

### Added
- `implement-logger` skill with concern-based KEY naming guide
- `test-investigation` skill for structured test debugging
- Responsibility-aligned runner tests: FlowOrchestrator, CompletionManager, dry-run
- BreakdownLogger integration in runner tests
- `examples/` directory with E2E verification scripts organized by use case (setup, CLI, MCP, docs, agents, registry)
- 15-task codebase refactoring: uv type unification, skill English translation, fs-utils extraction, logger introduction, test consolidation, MCP test separation, prompt externalization, and more

### Changed
- BreakdownLogger dependency upgraded
- API bypass prevention added to agent runner
- Skills condensed for maintainability
- CI workflow aligned with deno.json task definitions
- deno.json scopes cleaned up (fmt, lint, test, include)
- Test naming conventions unified
- InitResult type standardized across init subsystem

## [1.11.23] - 2026-02-15

### Fixed
- `getCompletionCriteria()` now branches on `closureAction` setting (`close` / `label-only` / `label-and-close`) instead of always returning "Issue closed"
- `factory.ts` threads `definition.github.defaultClosureAction` to `IssueCompletionHandler`
- Fallback templates added for `label-only` variant (`initial_issue_label_only`, `continuation_issue_label_only`)
- Root cause: V2 rewrite (commit 4170695) dropped branching logic from 35ad2cf; tests deleted simultaneously prevented regression detection

## [1.11.13] - 2026-02-08

### Added
- SDK cost metrics (`totalCostUsd`, `numTurns`, `durationMs`) propagated to `AgentResult`, JSONL logs, and console output

### Fixed
- `DEFAULT_SANDBOX_CONFIG` converted to lazy function `getDefaultSandboxConfig()` to avoid `--allow-env` requirement at import time

## [1.11.12] - 2026-02-08

### Fixed
- `buildCompletionCriteria()` now reflects `defaultClosureAction` setting — prompt layer generates "complete your phase" instead of "close" when `label-only` is configured
  > Note: This fix was inadvertently lost in the V2 rewrite (4170695, Feb 9) and restored in v1.11.23.
- `buildInitialPrompt()` and `buildContinuationPrompt()` select label-only fallback templates when applicable
- JSR-distributed docs updated: `externalState` completion type, iterate-agent setup guides, and design notes now reference `defaultClosureAction` behavior

## [1.11.0] - 2026-01-25

### Added
- Label-only completion mode for issue closure (`defaultClosureAction: "label-only"`)
- Configurable completion labels in agent.json (`github.labels.completion`)
- AI can override closure action via structured output (`closure.action`)

### Fixed
- `setGitHubConfig()` was not being called, causing `defaultClosureAction` to be ignored
- Label removal fails gracefully when label doesn't exist on issue
- Block `gh issue close` commands during closure steps via tool policy

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
