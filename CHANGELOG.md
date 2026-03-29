# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.13.15] - 2026-03-28

### Fixed
- Resolve 7 UV initial prompt contradictions in runner and validator
- Channel 3 Flow Loop UV injection (max_iterations, remaining, previous_summary)
- Channel 4 handoff collision detection (log and keep Channel 1 value)
- Template validator previous_summary catch-22 via runtime-supplied allowlist

### Changed
- Align scaffolder templates with `{uv-issue}` convention (`issue_number` → `issue`)
- Scaffolder continuation template uses `{uv-previous_summary}` (Channel 3 UV)
- Prompt-resolution example uses `{uv-issue}` matching actual agent convention

### Added
- Contradiction-verification skill and UV contradiction proof tests
- Channel 3 Flow Loop end-to-end test (`uv-channel3-flow-loop_test.ts`)
- Previous-summary catch-22 test (`uv-previous-summary-catch22_test.ts`)

## [1.13.14] - 2026-03-28

### Added
- GitHub Project MCP tools (`gh project` integration)

### Changed
- Extract `RateLimiter`, `BatchRunner`, `HandoffManager` modules from orchestrator
- Extract `resolveTerminalOrBlocking` to label-resolver

### Fixed
- Lint errors in orchestrator (`no-await-in-loop`, type issues)
- Docs manifest generator `no-await-in-loop` lint compliance

## [1.13.13] - 2026-03-26

### Added
- Graph-driven CLI help system replacing `--help` subprocess dispatch
- Help protocol MCP tool (describe/scaffold/validate)
- Unified help concept design document (v8)

### Changed
- Replace subprocess dispatch with in-process AgentRunner call

### Fixed
- Harden release-procedure skill with exit-code gates and post-conditions (prevent release leaks)

## [1.13.12] - 2026-03-26

_Code merged to main without version bump. Retroactively tagged._

### Added
- Graph-driven CLI help system (same as 1.13.13 — this release was not published to JSR)

## [1.13.11] - 2026-03-25

### Changed
- Bump version to 1.13.11, fix query-executor test
- Update issueStore default path to .agent/climpt/tmp/issues

### Added
- GitHubRead MCP tool and harden sandbox GitHub access control
- Rate limit throttle to orchestrator and sandbox excludedCommands

### Fixed
- Remove excludedCommands from sandbox defaults
- Harden rate limit data validation against NaN/Infinity

### Refactored
- Extract DEFAULT_ISSUE_STORE constant in orchestrator

## [1.13.10] - 2026-03-24

### Changed
- Rename `deno task workflow` to `deno task orchestrator`
- Replace raw file paths with JSR export paths in usage docs

### Added
- excludedCommands to sandbox config for TLS/Keychain bypass
- File-based JSONL logging for orchestrator workflow
- Task planning and remote CI waiting to release procedure skill

## [1.13.9] - 2026-03-23

### Fixed
- Detect stale orchestrator locks by PID liveness instead of timeout only
- Exclude examples/tmp/ from lint to prevent false failures

### Added
- Orchestrator as top-level entry point alongside agents

## [1.13.8] - 2026-03-22

_Version bump only._

## [1.13.7] - 2026-03-22

### Fixed
- Workflow `--dry-run` now exits 0 for actionable issues (was always exit 1)
- Empty/all-terminal batch returns status `"completed"` (was `"partial"` causing exit 1)
- `--prioritize` without `prioritizer` config now throws `ConfigError` WF-BATCH-001 (was silent fallback)
- `--prioritize` with `--dry-run` no longer writes to IssueStore or pushes labels
- Defensive silent-completion paths in workflow router converted to explicit `RoutingError`
- Backward-compat fallback for handoff without transition removed (now throws `RoutingError`)

### Added
- ConfigError catalog: 71 centralized error factories with SR/AC/WF/PR code prefixes (`config-errors.ts`)
- StepContext Channel 4 handoff: `stepId_key` namespace UV variables via `toUV()` (`step-context.ts`)
- CompletionLoopProcessor: extracted from runner as independent module (`completion-loop-processor.ts`)
- Orchestrator design doc with status/exit code tables (`12_orchestrator.md`)
- Workflow E2E examples 32-55 covering config, resolution, batch, handoff, and dual-loop scenarios

### Changed
- Flow Loop enforces C3L-only prompt resolution (no fallback prompt paths)
- Batch status determined by `errorCount` (caught exceptions), not by presence of skipped issues

### Removed
- Dead CLI entry points: `agents/cli.ts`, `agents/runner/cli.ts` (replaced by `run-agent.ts`)
- Defensive `intentField` fallback in StepGateInterpreter (field is required in type)
- Unused imports: `RoutingResult`, `PATHS`, `lastSummary` in runner modules

## [1.13.6] - 2026-03-16

### Changed
- UV reachability validator now only checks Channel 1 (CLI parameters); runtime-supplied variables are silently skipped (`uv-reachability-validator.ts`)

### Removed
- Hardcoded `RUNTIME_VARIABLES` set from UV reachability validator (previously: iteration, completed_iterations, completion_keyword)

## [1.13.5] - 2026-03-15

### Fixed
- Flow validator now recognizes `entryStep` (singular) as BFS starting point for reachability checks (`flow-validator.ts`)
- Template UV validator skips fallback template checks when no C3L prompt file exists (`template-uv-validator.ts`)
- UV reachability validator reads `registry.runtimeUvVariables` and merges with hardcoded runtime variables (`uv-reachability-validator.ts`)

### Changed
- Blueprint schema enums converted to `oneOf`+`const`+`title` format for discoverability (`agent-blueprint.schema.json`)

### Added
- UV variable supply Channel 3 (VerdictHandler) documented in blueprint spec
- Blueprint spec and schema added to docs manifest

## [1.13.4] - 2026-03-15

### Added
- AgentBlueprint language spec: cross-file integrity rules for agent.json, steps_registry.json, and schemas (`agents/docs/builder/reference/blueprint/`)
- `agent-blueprint.schema.json`: 1305-line JSON Schema enforcing 52 integrity rules with if/then per stepKind, verdict-type-specific config validation, and section step constraints
- Blueprint design doc (`agents/docs/design/11_blueprint_language.md`)
- `runtimeUvVariables` field in registry section for declaring runtime-supplied UV variables

### Changed
- Intent enum reduced from 7 to 6 values: removed `abort` (not in any STEP_KIND_ALLOWED_INTENTS)
- R-B3 now enforced structurally in schema via stepKind-specific if/then blocks

## [1.13.3] - 2026-03-14

### Fixed
- Verdict fallback prompts missing CLI-derived UV variables (`buildUvVariables` not called in verdict path)
- Unsourced `previous_status` UV variable in `continuation.statuscheck` facilitator prompt
- Registry loader not normalizing `null` uvVariables and missing `usesStdin` fields

### Added
- UV variable reachability and template consistency validation in `--validate` (`uv-reachability-validator.ts`, `template-uv-validator.ts`)
- Prefix substitution logging at both substitution sites: `workflow-router.ts` and `verdict/factory.ts`
- Prompt fallback WARNING when user C3L file not found (`prompt-resolver.ts`)
- Actionable hints in UV variable error messages with prefix substitution awareness
- Initial/continuation UV consistency check in `--validate`
- Prefix substitution documentation (`11-runner-reference.md`, `14-steps-registry-guide.md`)
- `permissionMode` mismatch troubleshooting (`12-troubleshooting.md`)

### Changed
- Unified uvVariable name `issue_number` to `issue` across all agents
- Query executor extracts tool name from content blocks (`query-executor.ts`)

## [1.13.2] - 2026-03-14

### Fixed
- Empty UV variables (`--uv-repository=`) rejected by breakdown when `--repository` not provided (`c3l-prompt-loader.ts`, `external-state-adapter.ts`)
- Schema loading via `Deno.readTextFile(URL)` fails when imported from JSR (`schema-validator.ts`)
- `--validate` path/flow validators had lint errors (`path-validator.ts`, `flow-validator.ts`)

### Added
- Prompt resolution validation in `--validate`: fallbackKey existence, C3L component check, stepId consistency (`prompt-validator.ts`)
- `--validate` path existence and flow reachability checks (`path-validator.ts`, `flow-validator.ts`)
- fallbackKey reference, prompt resolution flow, and troubleshooting docs (`11-runner-reference.md`, `12-troubleshooting.md`, `14-steps-registry-guide.md`)
- Runner-LLM contract design model and stepKind rationale (`14-steps-registry-guide.md`)

### Changed
- `--dry-run` doc references corrected to `--validate` (`README.md`, `scaffold.ts`)

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
