# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.14.0] - 2026-05-02

### Migration (breaking) — `.agent/workflow.json` schema

Repositories using the legacy fields below MUST rewrite `.agent/workflow.json`
before installing this release. No backward compatibility is provided: the
loader rejects the legacy shape at load time.

#### Replacement mapping

| Legacy field (removed) | New field | Hint |
|------------------------|-----------|------|
| `closeOnComplete: true` (per agent) | `closeBinding: { primary: { kind: "direct" } }` | `direct` = close on terminal-bound transition (default choice). |
| `closeOnComplete: false` (per agent) or field absent | omit `closeBinding` (equivalent to `{ primary: { kind: "none" } }`) | Handoff-only agent; no close path. |
| `closeCondition: "<outcome>"` (per agent) | `closeBinding.condition: "<outcome>"` | Outcome-equality guard; must be a key in `outputPhases`. |
| `validationConditions: [...]` (steps_registry validators) | `preflightConditions: [...]` + `postLLMConditions: [...]` | Split per failure scope: preflight = abort-only; postLLM = retry-able. |
| `criteria.allProjects: true` | `issueSource: { kind: "ghRepoIssues", projectMembership: "any" }` | Cross-repo label/state filter spanning any project membership. |
| `criteria.*` field-presence pattern | `issueSource: { kind: "ghProject" \| "ghRepoIssues" \| "explicit", ... }` | Declared explicitly via `kind` (3-variant ADT). |
| `dryRun: true` (declarative flag) | removed from schema | Use `Transport=File` at runtime instead (design 01 §D). |
| `OrchestratorResult.issueClosed` (consumer code) | observe `IssueClosedEvent` / `IssueCloseFailedEvent` on the bus | Consumers subscribe instead of polling a result field. |

> If a legacy config carries only `closeCondition` (without `closeOnComplete`),
> migration to `closeBinding.condition` is still required: the loader rejects
> the legacy `closeCondition` field on its own.

`closeBinding.primary.kind` has 5 variants — choose by close-decision channel:

- `direct` — close on terminal-bound phase transition (typical)
- `boundary` — close at Closure-step boundary, independent of phase transition
- `outboxPre` — close via outbox `PreClose` action
- `custom` — user-defined channel (`channel.channelId` required)
- `none` — no close path (handoff-only)

#### Example: one agent, before / after

```jsonc
// before
"agents": {
  "iterator": {
    "role": "transformer",
    "closeOnComplete": true,
    "closeCondition": "ok"
  }
}

// after
"agents": {
  "iterator": {
    "role": "transformer",
    "closeBinding": {
      "primary": { "kind": "direct" },
      "condition": "ok"
    }
  }
}
```

#### sed-pattern (best-effort)

> Note: `workflow.json` is restructured, not just renamed. Mechanical
> substitution does not complete the migration. Run `deno task ci` (or
> the agent loader) and confirm the loader does not reject the resulting
> shape.

> The sed pattern below matches only canonical line-oriented jsonc (one
> field per line, trailing `,`, double-quoted keys). Inline forms such as
> `{ "closeOnComplete": true }`, alternate quoting, or blocks with inline
> comments are silently skipped and must be migrated by hand. Final
> verification is `deno task ci` (workflow loader rejects any remaining
> legacy field).

Starting points for grep / sed / jq:

- Locate agents that need rewriting:
  ```sh
  grep -nE '"closeOnComplete"|"closeCondition"' .agent/workflow.json
  ```
- Delete the two legacy keys (manual rewrite of `closeBinding` still required):
  ```sh
  sed -i.bak -E '/^[[:space:]]*"closeOnComplete":[[:space:]]*(true|false),?$/d; /^[[:space:]]*"closeCondition":[[:space:]]*"[^"]*",?$/d' .agent/workflow.json
  ```
- Replace `criteria.allProjects: true` blocks (manual rewrite to `issueSource`):
  ```sh
  grep -nE '"allProjects"[[:space:]]*:[[:space:]]*true' .agent/workflow.json
  ```
- Locate `validationConditions` arrays for split into preflight / postLLM:
  ```sh
  grep -n '"validationConditions"' .agent/steps_registry.json
  ```
- Locate the declarative `dryRun` flag for removal:
  ```sh
  grep -nE '"dryRun"[[:space:]]*:[[:space:]]*true' .agent/workflow.json
  ```

#### Items NOT requiring migration

- `agents: Record<string, AgentDefinition>` map — disk shape stays; the
  loader derives the runtime `invocations` view via `deriveInvocations()`.
- `phases.{id}.agent: string | null` — disk shape stays.
- `outputPhase` / `outputPhases` / `fallbackPhase` / `fallbackPhases` —
  disk shape stays.
- `agent.role` enum on `workflow.json` — still 2-value (`"transformer"
  | "validator"`).

#### Detailed reference

- `agents/docs/builder/06_workflow_setup.md` — Close binding section
- `agents/docs/builder/09_closure_output_contract.md`
- Internal design: `agents/docs/design/realistic/13-agent-config.md` §F

### Added
- **Realistic-design migration (Phase 1-6 complete).** ADT-first
  rewrite of the agent runtime so the 7 MUST requirements
  (R1..R6 + Layer-4 inheritance) are each anchored by a structural
  hard gate. Highlights:
  - `agents/boot/` — `BootKernel` + 27 boot rules (W1..W11 / A1..A8 /
    S1..S8) + deepFreeze of the assembled `BootArtifacts` tree
    (Critique F1 single-freeze invariant)
  - `agents/events/` — `CloseEventBus` with 8 events, frozen
    subscriber set, diagnostic JSONL subscriber
  - `agents/channels/` — 6 close channels (DirectClose / OutboxClose-pre /
    OutboxClose-post / BoundaryClose / CascadeClose / MergeClose) +
    `CompensationCommentChannel` (W13 contract: comment-only
    compensation on close failure, no label rollback) +
    `CustomCloseChannel` skeleton + `MergeCloseAdapter` bridging
    merge-pr facts onto the bus
  - `agents/orchestrator/subject-picker.ts` — R2b mode unification:
    run-agent now flows through the same `SubjectPicker` instance as
    the orchestrator, with input source switched to argv (no
    bypass picker)
  - `GateIntent` reduced to 6 values (`abort` removed; reclassified
    as `error-recovery` per design 16 §F)
  - `AgentBundle.closeBinding` is the single declarative source of
    truth for close-path declaration (legacy on-disk
    `runner.verdict.handoff` removed from the active path)
  - `Policy.applyToSubprocess` honoured: `BootKernel.boot` writes
    `tmp/boot-policy-<runId>.json`; `merge-pr` reads + freezes the
    inherited Policy via `BOOT_POLICY_FILE` / `CLIMPT_PARENT_RUN_ID`
    env (design 20 §E + Critique F15 inheritance contract)
  - `tools/lint-anti-list.ts` + `tools/lint-inline-schema.ts` enforce
    the design's anti-list invariants at lint time
  - `agents/traceability/r1-r7_test.ts` — 7-MUST × design-element
    structural matrix asserts each hard gate is reachable
- Considerer `deferred_items[]` carves roadmap-scale scope into
  follow-up issues: schema field + prompt branch. Orchestrator
  (`DeferredItemsEmitter`) expands each entry into an outbox
  `create-issue` action before the current issue closes in T6,
  so residual tasks are discoverable via the label trail instead
  of close-comment prose (#480)
- **Project orchestration loop (O1/O2/T6.eval).** `projectBinding`
  hook enables orchestrator-level project awareness:
  - Hook O2 inherits parent-project membership on `create-issue`
    outbox actions (`agents/orchestrator/hook-o1-o2-integration_test.ts`)
  - T6.eval sentinel label flip chain for project-scoped evaluation
    (`agents/channels/` e2e tests)
- **Project v2 primitives.** `issueSource` ADT on `WorkflowConfig`
  (`agents/orchestrator/workflow-types.ts`) with 3 variants:
  `ghProject`, `ghRepoIssues`, `explicit` — replacing the legacy
  `criteria.*` field-presence pattern
- **Project CLI commands:**
  - `project:init` (`agents/scripts/project-init.ts`) — bootstrap
    sentinel issue for project-planner routing
  - `project:list` (`agents/scripts/project-list.ts`) — list GitHub
    Projects v2 for a given owner
  - `project:items` (`agents/scripts/project-items.ts`) — list items
    in a GitHub Project v2 with field values
- **Project-planner agent** (`.agent/project-planner/`) for
  project-scoped planning via sentinel issue dispatch

### Removed
- `GateIntent.abort` variant: the 12 historical sites are
  reclassified to `error-recovery`. Routing collapses through the
  remaining 6-value enum so the closure boundary stays exhaustive.
- Legacy procedural close paths in `orchestrator.ts`,
  `outbox-processor.ts`, and `verdict/external-state-adapter.ts`:
  every close now flows through a declarative `Channel.execute` —
  the orchestrator no longer calls `closeIssue` directly.

## [1.13.26] - 2026-04-18

### Added
- `TransactionScope` saga for orchestrator phase transitions: LIFO
  compensation registry eliminates the "label 宙ぶらり" gap where a
  label update succeeded but `closeIssue` failed (`agents/orchestrator/transaction-scope.ts`)
- `reopenIssue` and `getRecentComments` on `GitHubClient` for
  compensation execution and marker-based idempotency
- `compensationMarker(issueNumber, cycleSeq)` factory as the single
  source of truth for compensation comment identity; visible footer
  signature replaces the HTML-comment marker for operator auditability
- Self-heal E2E test: T6 failure on one run recovers on the next,
  with compensation comment posted exactly once across retries
- L3 phase repetition limit (`maxConsecutivePhases`) for orchestrator
  to bound same-phase loops (#477)
- `fallbackPhases` on transformer for outcome-specific routing (#472)
- Declarative labels in `workflow.json` with idempotent label sync (#478)
- Declarative handoff pipeline for typed inter-agent artifacts
- Triager + considerer agents for 2-stage issue workflow
- Detailer agent enabling 3-stage consider → detail → impl flow
- PR Merger agent (Phase 0-b/c + `merge-pr.ts` + merger configs)
- `option-scoring` skill for quantified design-fit review
- Task 13 in release-procedure skill: next-version branch bootstrap
- Builder `flow_design` guide with renumbered GitHub / closure docs
- PR Merger design docs (T14 runner-mediated flow)

### Changed
- Orchestrator phase-transition block rewritten as a T1..T7 saga;
  `cycleTracker.record` now fires only on full T3..T6 success
- Rename `IssueStore` → `SubjectStore` across orchestrator, configs,
  and tests
- Prioritizer labels stripped on terminal phase transitions
- Upgrade `@tettuan/breakdown` 1.8.4 → 1.8.7 and remove silent-failure
  bridge
- `.agent` workflow rules tuned for v1.13.26 (`maxCycles` 2→7, L3=3
  enabled)
- Rename `.agent/workflow-issue-execute.json` → `workflow.json`
- `test-design` skill gains the Derivation ladder (import → named
  constants → arithmetic-comment → bare literal) and three new
  anti-patterns: Prose derivation alibi, Assertion bloat, Delegation
  trust; Decision Framework adds Q4 (assertion-to-invariant alignment)
- Orchestrator test suite: `labelUpdates.length` expected values
  derived from `LABEL_CALLS_PER_TRANSITION = 2` (design §2.2) instead
  of bare literals
- Cross-reference docs-consistency and update-docs skills
- `artifact-emitter` no longer uses `$.github.pr.*` root
- `.claude` disables climpt-agent plugin in climpt project

### Fixed
- C3L: sanitize UV `previous_summary` and surface PR-C3L-002 for
  non-`TemplateNotFound` errors
- C3L: surface breakdown error detail in PR-C3L-004 with exhaustive
  dispatch tests
- C3L: surface breakdown silent-failure as PR-C3L-002
- Runner: extract verdict from boundary hook in
  `IterationBudgetVerdictHandler`
- Runner: fail `AgentResult` when handler is done but no LLM response
- Runner: propagate iteration to verdict handler + apply parameter
  defaults
- Orchestrator: enforce validator verdict contract, add `fallbackPhase`
- Orchestrator: resolve phantom-success and label regression bugs
- Detailer: add missing label-only prompt and breakdown configs (#479)
- `.agent`: use `{uv-*}` prefix for UV variable substitution in prompts
- Lint: suppress `no-await-in-loop` for sequential label sync

## [1.13.25] - 2026-04-11

### Fixed
- Derive C3LPromptLoader workingDir from module location instead of `Deno.cwd()` (#464)
- Add execution vs reference mode guard to release skill
- Remove diagnostic logger, retain regression tests (#464)

### Changed
- Replace manual YAML parsing with `@tettuan/breakdownconfig` for prompt root resolution
- Document C3L component connection points (config system, prompt system, prompt-architecture)
- Improve update-docs skill with commit coverage plan and help concept reference

## [1.13.24] - 2026-04-11

### Changed
- Clarify conciseness rule in skills: drop filler words, preserve qualifiers
- Add step-level `permissionMode` override to builder guides and `--help` output
- Add conciseness rules to `update-docs` and `docs-consistency` skills

## [1.13.23] - 2026-04-11

### Added
- `service-consistency` skill for end-to-end service verification
- Frontmatter/registry UV validator and config/registry consistency validator (#460)
- Key concepts to `--help`, UV reachability troubleshooting, and error-guide mapping
- Step-level `permissionMode` override for tool policy
- CI optimization: run tests only on PR to develop, not every push

### Fixed
- Inject `max_iterations` and `remaining` in `poll:state` verdict handler (#461)
- Remove `runtimeUvVariables` from schema, use `RUNTIME_SUPPLIED_UV_VARS` (#462)
- Exclude continuation-only UV vars from prefix substitution comparison (#459)
- Display errors from `stepRegistryValidation` and `handoffInputsResult` in `--validate` output (#456)
- Remove fallback implementation, make C3L-only prompt resolution
- Enforce plan mode restrictions, improve validation and docs fetch stability
- Pass `conditionParams` to command validators for interpolation
- Implement two-phase validation model for closure loop
- Example 18 sets step-level `permissionMode` to enforce plan mode
- Fix `require-await` lint in `validateState`

### Changed
- Remove `userPromptsBase` and `schemasBase` from Runner, enforce C3L coordinate boundary
- Consolidate prompt path building to `buildPromptFilePath`, use PATHS constant
- Remove `fallbackKey` from schema, types, validators, and configs
- Standardize skill naming conventions and fill service consistency gaps
- Extract message constants from validators, improve test assertions
- Update validation documentation to reflect four-phase model
- Improve test quality: path-validator (P1-P4), template-uv-validator edge cases, test-design evaluation fixes

## [1.13.22] - 2026-04-08

### Added
- `closeOnComplete` option for orchestrator terminal phases (#455)

### Fixed
- Route `detect:graph` verdict to orchestrator outputPhases (#454)
- Detect continuation-only UV variables in `initial.*` steps (#453)
- Add `getLastVerdict` to mock VerdictHandlers and fix lint

### Changed
- Promote `getLastVerdict` to VerdictHandler interface

## [1.13.21] - 2026-04-07

### Added
- Semantic workflow validation across 4 phases covering 22 validation gaps

### Fixed
- Allow digits in c3 schema pattern for registry generation

### Changed
- Remove built-in agent references from README and docs (EN/JA)
- Exclude `.agent/` directory from JSR publish

## [1.13.20] - 2026-04-06

### Added
- Countdown timer with safe-stop message between orchestrator cycles
- Validator testing guidance to test-design and functional-testing skills
- `validateStepKindIntents` tests for closure intent constraint

### Fixed
- Correct closure step intent from "continue" to "repeat" in builder contract
- Improve lock skip message with actionable guidance
- Add PID lock to run-all.sh to prevent concurrent execution
- Add enable flag guard to run-all.sh to prevent concurrent launchd races

### Changed
- Improve validator tests across 4 aspects and fix assertStringIncludes anti-pattern
- Compress validator testing guidance in skills to reduce token usage

## [1.13.19] - 2026-04-06

### Changed
- **BREAKING**: handoff.commentTemplates template variables are now sourced from closure step's handoffFields instead of hardcoded values. `{session_id}`, `{issue_count}`, `{summary}` are removed. Use closure step schema fields via handoffFields instead (#446)

### Added
- DispatchOutcome.handoffData: closure step structured output fields flow to handoff comment templates
- handoff.commentTemplates documentation in builder guide, workflow guide (en/ja), schema, reference, and example fixture
- `climpt upgrade` command for user-side version update
- upgrade-climpt skill
- docs-writing skill permission and rule
- test-design skill enforcement rule
- Closure output contract documentation (builder guide 08)

## [1.13.18] - 2026-04-05

### Fixed
- Resolve shadow contract in RetryHandler and expand config test coverage
- Restore runner-required phases in breakdown config patterns (#443)
- Add trigger phrases to work-process skill description

### Changed
- Rename workflow skill to work-process with mode-driven entry

### Added
- test-design skill for structurally sound test construction
- Improve structural quality across test suite

## [1.13.16] - 2026-04-01

### Fixed
- Resolve 15 GAPs between GitHub Integration docs and implementation
- Resolve 6 implementation/docs issues from code review
- Align enabled-flag defaults in docs with applyDefaults() source of truth
- Auto-cleanup orchestrator lock on process termination
- Orchestrator lock uses ps -p for cross-user PID check
- Resolve lint error (require-await) in issue-store release()
- Update initBasic test expectation after schema/ directory removal

### Changed
- Remove allowFallback — enforce C3L-only prompt resolution
- Add agents/docs/builder/ to docs manifest as builder-guides category

### Added
- GitHub Integration Guide to builder docs
- Clarify issue comment routes and gh command mapping in GitHub Integration Guide
- Add C3L config setup to example 25 after allowFallback removal
- Version consistency check to local CI

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
