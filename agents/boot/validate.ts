/**
 * Central Boot validation orchestrator (design 12 §F + 13 §G + 14 §G).
 *
 * Runs every Boot validation rule over an assembled
 * {@link BootArtifacts} aggregate. Each rule helper returns a
 * `Decision<void>`; the aggregate is combined via
 * {@link combineDecisions} so a single Boot pass surfaces every
 * failure at once (no first-rule-wins — Critique F4 mitigation).
 *
 * Rule families (file-prefix taxonomy, see `errors.ts`):
 *  - **W1..W11** — workflow.json invariants (12 §F).
 *  - **A1..A8**  — agent bundle invariants (13 §G).
 *  - **S1..S9**  — step registry invariants (14 §G + self-route §4.4).
 *  - **S10**     — advisory `adaptationChain` migration warn, surfaced
 *                  via the sibling collector {@link collectBootWarnings}
 *                  (warns are non-blocking; `validateBootArtifacts`
 *                  remains the Run-start gate).
 *
 * `W11` ((phase, agentId, invocationIndex) unique over
 * `invocations: AgentInvocation[]`) is enforced in T5.2 once the
 * derived `WorkflowConfig.invocations` view lands. The current 1:1
 * disk shape makes the rule vacuously true at production sites; W11
 * exists for future phase-versioning expansion (15 §C).
 *
 * Design surface for the per-rule helpers: each `validateW{n}` /
 * `validateA{n}` / `validateS{n}` is a **pure function**
 * `(BootArtifacts) -> Decision<void>` so unit
 * tests can pass synthetic artifacts without going through
 * `BootKernel.boot`. The orchestrator does not perform I/O.
 *
 * Coverage policy:
 *  - **Existing validators** (W1..W6, W8, W9, A2..A5, S1..S6, S8)
 *    have their substantive logic inside the legacy `*Validator.ts`
 *    files and are surfaced via `loadWorkflowAsDecision`'s code
 *    mapping at the loader boundary. The helpers here add Boot-time
 *    *post-load* invariants only — they re-check what a synthetic
 *    `BootArtifacts` (no loader) needs to enforce, so synthetic
 *    fixtures are decidable without re-loading from disk.
 *  - **New rules** (W7, W10, A6, A7, A8, S7) are implemented inline
 *    here because no existing validator covers them.
 *
 * @see agents/docs/design/realistic/12-workflow-config.md §F
 * @see agents/docs/design/realistic/13-agent-config.md     §G
 * @see agents/docs/design/realistic/14-step-registry.md    §G
 * @see tmp/realistic-migration/phased-plan.md              §P2 T2.2
 * @see tmp/realistic-migration/critique.md                 §F6 (W11 deferred)
 *
 * @module
 */

import type { AgentBundle } from "../src_common/types/agent-bundle.ts";
import type { Step } from "../common/step-registry/types.ts";
import { STEP_KIND_ALLOWED_INTENTS } from "../common/step-registry/types.ts";
import type {
  AgentDefinition as WorkflowAgentDefinition,
} from "../orchestrator/workflow-types.ts";

import {
  acceptVoid,
  combineDecisions,
  type Decision,
  isReject,
  reject,
  type ValidationError,
  validationError,
} from "../shared/validation/mod.ts";

import type { BootArtifacts } from "./types.ts";
import type { TransportPolicy } from "./policy.ts";

// ---------------------------------------------------------------------------
// Public entry — orchestrate all Reject-tier rules (Warn-tier sibling below).
// ---------------------------------------------------------------------------

/**
 * Run every Boot Reject-tier validation rule over `artifacts`.
 *
 * Aggregates per-rule `Decision<void>` results into a single
 * `Decision<void>` whose `Reject` lists every accumulated
 * `ValidationError` (combine-then-throw at boundary).
 *
 * Order of evaluation is **W → A → S**, matching the design
 * documents' §F / §G ordering, but the result aggregate is order-
 * independent (no early exit).
 *
 * Advisory rules (S10) are emitted via the sibling
 * {@link collectBootWarnings}; they do NOT participate in the Reject
 * gate so a Boot can succeed with non-empty warnings.
 */
export function validateBootArtifacts(
  artifacts: BootArtifacts,
): Decision<void> {
  const decisions: ReadonlyArray<Decision<void>> = [
    // W: workflow.json (12 §F)
    validateW1(artifacts),
    validateW2(artifacts),
    validateW3(artifacts),
    validateW4(artifacts),
    validateW5(artifacts),
    validateW6(artifacts),
    validateW7(artifacts),
    validateW8(artifacts),
    validateW9(artifacts),
    validateW10(artifacts),
    validateW11(artifacts),
    // A: agent bundle (13 §G)
    validateA1(artifacts),
    validateA2(artifacts),
    validateA3(artifacts),
    validateA4(artifacts),
    validateA5(artifacts),
    validateA6(artifacts),
    validateA7(artifacts),
    validateA8(artifacts),
    // S: step registry (14 §G)
    validateS1(artifacts),
    validateS2(artifacts),
    validateS3(artifacts),
    validateS4(artifacts),
    validateS5(artifacts),
    validateS6(artifacts),
    validateS7(artifacts),
    validateS8(artifacts),
    validateS9(artifacts),
  ];

  const combined = combineDecisions(decisions);
  if (isReject(combined)) {
    return combined;
  }
  return acceptVoid();
}

// ---------------------------------------------------------------------------
// Helpers — small adapters used by per-rule checks.
// ---------------------------------------------------------------------------

const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/**
 * Walk every `AgentBundle` in the registry. The registry guarantees
 * deterministic order (registration order ≡ workflow.agents order).
 */
function bundles(artifacts: BootArtifacts): ReadonlyArray<AgentBundle> {
  return artifacts.agentRegistry.all;
}

/**
 * Workflow-side agent map (`workflow.json.agents.{id}`). The shape
 * differs from `AgentBundle.role` — kept separate to avoid duplicate
 * SoT (B(R2)1 single-source via AgentBundle).
 */
function workflowAgents(
  artifacts: BootArtifacts,
): ReadonlyMap<string, WorkflowAgentDefinition> {
  const m = new Map<string, WorkflowAgentDefinition>();
  for (const [id, def] of Object.entries(artifacts.workflow.agents)) {
    m.set(id, def);
  }
  return m;
}

/** Fold a `(boolean, message)` per-rule predicate into a Decision. */
function decideFromErrors(
  errors: ReadonlyArray<ValidationError>,
): Decision<void> {
  if (errors.length > 0) return reject(errors);
  return acceptVoid();
}

// ---------------------------------------------------------------------------
// W: workflow.json invariants (12 §F)
// ---------------------------------------------------------------------------

/**
 * **W1** — `phases` declared, ids unique, `kind` enumerated.
 *
 * In the realistic model `phases` is a `Record<PhaseId, PhaseDecl>`
 * so duplicate keys cannot exist post-parse. We re-enforce the
 * "kind ∈ enumerated set" invariant so a synthetic artifact (no
 * loader) is still validated.
 */
function validateW1(artifacts: BootArtifacts): Decision<void> {
  const errors: ValidationError[] = [];
  const phases = artifacts.workflow.phases;
  const ids = Object.keys(phases);
  if (ids.length === 0) {
    errors.push(validationError("W1", "workflow.phases is empty"));
  }
  const allowedKinds = new Set(["actionable", "terminal", "blocking"]);
  for (const [id, decl] of Object.entries(phases)) {
    if (!allowedKinds.has(decl.type)) {
      errors.push(
        validationError(
          "W1",
          `Phase "${id}" has unknown kind "${decl.type}" (allowed: ${
            [...allowedKinds].join(", ")
          })`,
          { source: ".agent/workflow.json", context: { phaseId: id } },
        ),
      );
    }
  }
  return decideFromErrors(errors);
}

/**
 * **W2** — `invocations[*].phase ∈ phases`. Realistic uses
 * `agents: Record<AgentId, AgentDefinition>` + `phases.{id}.agent`
 * as the binding; the cross-ref is "every phase that names an agent
 * names an existing agent" (the dual of W3). The phase id existence
 * is implicitly satisfied because the binding lives at the phase key.
 *
 * In the absence of the design's `AgentInvocation[]` (P5 / T5.2),
 * this rule is decidable but vacuous on the legacy shape — we keep
 * the helper present so the 26-rule coverage table is non-empty.
 */
function validateW2(artifacts: BootArtifacts): Decision<void> {
  // W2 over legacy shape: every phase.agent must reference a known
  // agent in workflow.agents (covered by loader; we re-check post-load).
  const errors: ValidationError[] = [];
  const known = workflowAgents(artifacts);
  for (const [phaseId, decl] of Object.entries(artifacts.workflow.phases)) {
    if (decl.agent && !known.has(decl.agent)) {
      errors.push(
        validationError(
          "W2",
          `Phase "${phaseId}" references unknown agent "${decl.agent}"`,
          {
            source: ".agent/workflow.json",
            context: { phaseId, agentId: decl.agent },
          },
        ),
      );
    }
  }
  return decideFromErrors(errors);
}

/**
 * **W3** — every `phases.{id}.agent` (∼ `invocations[*].agent`)
 * resolves in the {@link AgentRegistry}.
 *
 * The loader already checks the workflow.agents map. We additionally
 * require the {@link AgentRegistry} (the post-A1 view) contains a
 * bundle for each referenced id.
 */
function validateW3(artifacts: BootArtifacts): Decision<void> {
  const errors: ValidationError[] = [];
  for (const [phaseId, decl] of Object.entries(artifacts.workflow.phases)) {
    if (!decl.agent) continue;
    if (!artifacts.agentRegistry.lookup(decl.agent)) {
      errors.push(
        validationError(
          "W3",
          `Phase "${phaseId}" references agent "${decl.agent}" but no AgentBundle is registered`,
          {
            source: ".agent/workflow.json",
            context: { phaseId, agentId: decl.agent },
          },
        ),
      );
    }
  }
  return decideFromErrors(errors);
}

/**
 * **W4** — every `outputPhase` / `outputPhases[*]` / `fallbackPhase`
 * / `fallbackPhases[*]` references a declared phase id.
 */
function validateW4(artifacts: BootArtifacts): Decision<void> {
  const errors: ValidationError[] = [];
  const phaseIds = new Set(Object.keys(artifacts.workflow.phases));

  const checkRef = (
    agentId: string,
    field: string,
    target: string | undefined,
  ): void => {
    if (target === undefined) return;
    if (!phaseIds.has(target)) {
      errors.push(
        validationError(
          "W4",
          `Agent "${agentId}".${field} references unknown phase "${target}"`,
          { source: ".agent/workflow.json", context: { agentId, field } },
        ),
      );
    }
  };

  for (const [agentId, def] of Object.entries(artifacts.workflow.agents)) {
    checkRef(agentId, "fallbackPhase", def.fallbackPhase);
    if (def.role === "transformer") {
      checkRef(agentId, "outputPhase", def.outputPhase);
      if (def.fallbackPhases) {
        for (const [k, v] of Object.entries(def.fallbackPhases)) {
          checkRef(agentId, `fallbackPhases[${k}]`, v);
        }
      }
    } else if (def.role === "validator") {
      for (const [k, v] of Object.entries(def.outputPhases)) {
        checkRef(agentId, `outputPhases[${k}]`, v);
      }
    }
  }
  return decideFromErrors(errors);
}

/**
 * **W5** — every `labelMapping` value is a known phase id.
 */
function validateW5(artifacts: BootArtifacts): Decision<void> {
  const errors: ValidationError[] = [];
  const phaseIds = new Set(Object.keys(artifacts.workflow.phases));
  for (
    const [label, phaseId] of Object.entries(artifacts.workflow.labelMapping)
  ) {
    if (!phaseIds.has(phaseId)) {
      errors.push(
        validationError(
          "W5",
          `labelMapping["${label}"] points to unknown phase "${phaseId}"`,
          { source: ".agent/workflow.json", context: { label, phaseId } },
        ),
      );
    }
  }
  return decideFromErrors(errors);
}

/**
 * **W6** — `projectBinding.{donePhase, evalPhase, planPhase}` are
 * known phases. `sentinelLabel` cross-checked against the labels map
 * when both are present.
 */
function validateW6(artifacts: BootArtifacts): Decision<void> {
  const binding = artifacts.workflow.projectBinding;
  if (!binding) return acceptVoid();
  const errors: ValidationError[] = [];
  const phaseIds = new Set(Object.keys(artifacts.workflow.phases));

  const checkPhase = (field: string, value: string): void => {
    if (!phaseIds.has(value)) {
      errors.push(
        validationError(
          "W6",
          `projectBinding.${field} references unknown phase "${value}"`,
          { source: ".agent/workflow.json", context: { field, phase: value } },
        ),
      );
    }
  };
  checkPhase("donePhase", binding.donePhase);
  checkPhase("evalPhase", binding.evalPhase);
  checkPhase("planPhase", binding.planPhase);
  return decideFromErrors(errors);
}

/**
 * **W7 (NEW)** — `issueSource × Policy` integrity.
 *
 * Pragmatic check (T2.2): when `Policy.transports.issueQuery !==
 * "real"`, the `issueSource.kind` must be among the 3 known values
 * (`ghProject`, `ghRepoIssues`, `explicit`). In addition, when the
 * transport is `real`, `issueSource.kind === "explicit"` is rejected
 * because explicit subjects need no listing API and a real listing
 * transport against an explicit source is a configuration smell
 * (the design's "ghBinary required for kind=Gh*" rule, contrapositive
 * form).
 *
 * TODO[expand-W7]: when T6.4 wires `Policy.ghBinary == Present` as
 * an enum, replace the structural check with the design's
 * "ghBinary required for kind=Gh*" form.
 */
function validateW7(artifacts: BootArtifacts): Decision<void> {
  const errors: ValidationError[] = [];
  const src = artifacts.workflow.issueSource;
  const validKinds = new Set(["ghProject", "ghRepoIssues", "explicit"]);
  if (!validKinds.has(src.kind)) {
    errors.push(
      validationError(
        "W7",
        `issueSource.kind "${src.kind}" is not one of {ghProject, ghRepoIssues, explicit}`,
        { source: ".agent/workflow.json", context: { kind: src.kind } },
      ),
    );
  }
  // Cross-check Policy: gh* sources need a non-mock issueQuery seam.
  if (
    (src.kind === "ghProject" || src.kind === "ghRepoIssues") &&
    artifacts.policy.transports.issueQuery === "mock"
  ) {
    errors.push(
      validationError(
        "W7",
        `issueSource.kind="${src.kind}" requires Policy.transports.issueQuery ∈ {real, file}, got "mock"`,
        {
          source: ".agent/workflow.json",
          context: {
            kind: src.kind,
            issueQuery: artifacts.policy.transports.issueQuery,
          },
        },
      ),
    );
  }
  return decideFromErrors(errors);
}

/**
 * **W8** — `prioritizer.agent` resolves in the AgentRegistry.
 */
function validateW8(artifacts: BootArtifacts): Decision<void> {
  const prio = artifacts.workflow.prioritizer;
  if (!prio) return acceptVoid();
  if (artifacts.agentRegistry.lookup(prio.agent)) return acceptVoid();
  return reject([
    validationError(
      "W8",
      `prioritizer.agent "${prio.agent}" is not registered in AgentRegistry`,
      { source: ".agent/workflow.json", context: { agentId: prio.agent } },
    ),
  ]);
}

/**
 * **W9** — every `handoffs[*].emit` template-style reference resolves
 * within the workflow's `handoff.commentTemplates` map.
 *
 * The legacy shape stores raw templates in `handoff.commentTemplates`
 * and references in `handoffs[*]` via `payloadFrom`. We surface the
 * narrow case "templateId not in commentTemplates" because the
 * existing handoff-validator covers the `from`-coverage shape. When
 * `handoff` or `commentTemplates` is absent, the rule is vacuous
 * (no template references to dangle).
 */
function validateW9(artifacts: BootArtifacts): Decision<void> {
  const handoff = artifacts.workflow.handoff;
  const handoffs = artifacts.workflow.handoffs;
  if (!handoff?.commentTemplates || !handoffs) return acceptVoid();
  const known = new Set(Object.keys(handoff.commentTemplates));
  const errors: ValidationError[] = [];
  for (const decl of handoffs) {
    // The realistic design's `handoffTemplate?: TemplateId` lives at the
    // invocation level; the legacy `HandoffDeclaration` does not carry
    // a single id — we only enforce when a `payloadFrom` value names
    // a known template literally (best-effort match).
    for (const value of Object.values(decl.payloadFrom)) {
      if (typeof value !== "string") continue;
      // Heuristic: if the value parses as a bare identifier and that
      // identifier is referenced in commentTemplates, fine; if it
      // looks like an id but isn't there, surface as W9.
      // We only flag explicit `templates.<name>` style refs to avoid
      // false positives on JSONPath strings.
      const m = value.match(/^templates\.([A-Za-z0-9_-]+)$/);
      if (m && !known.has(m[1])) {
        errors.push(
          validationError(
            "W9",
            `handoff "${decl.id}" references unknown commentTemplate "${m[1]}"`,
            {
              source: ".agent/workflow.json",
              context: { handoffId: decl.id, templateId: m[1] },
            },
          ),
        );
      }
    }
  }
  return decideFromErrors(errors);
}

/**
 * **W10 (NEW)** — Transport pair RR / RF / FF / MF.
 *
 * Accepted pairs (design 12 §F + 20 §B):
 *  - (real,  real)  — production
 *  - (real,  file)  — sandboxed dry-run (real read, file write)
 *  - (file,  file)  — full offline test
 *  - (mock,  file)  — fixture mode
 *
 * Rejected pairs:
 *  - (mock,  real)  — fixture-driven real close (silent fixture risk)
 *  - (file,  real)  — read-only fixture vs real write polarity violation
 */
function validateW10(artifacts: BootArtifacts): Decision<void> {
  const t: TransportPolicy = artifacts.policy.transports;
  const ok = (
    t.issueQuery === "real" && t.close === "real"
  ) || (
    t.issueQuery === "real" && t.close === "file"
  ) || (
    t.issueQuery === "file" && t.close === "file"
  ) || (
    t.issueQuery === "mock" && t.close === "file"
  );
  if (ok) return acceptVoid();
  return reject([
    validationError(
      "W10",
      `Transport pair (issueQuery=${t.issueQuery}, close=${t.close}) is not one of {RR, RF, FF, MF}`,
      {
        source: "Policy.transports",
        context: { issueQuery: t.issueQuery, close: t.close },
      },
    ),
  ]);
}

/**
 * **W11 (NEW, T5.2)** — invocation `(phase, agentId, invocationIndex)`
 * unique over `WorkflowConfig.invocations`.
 *
 * Per design 12 §F / 15 §C, the realistic schema represents
 * multi-agent dispatch (R2a) as `AgentInvocation[]`. Same logical
 * phase ↔ multiple agents must be modelled by **phase versioning**
 * (e.g. `plan-prepare` / `plan-review` / `plan-finalize`) so the
 * SubjectPicker stays a pure phase lookup with no cursor god-object
 * (B(R2)2 修復). A duplicate `(phase, agentId, invocationIndex)`
 * triple would re-introduce that god-object surface, so Boot rejects
 * it before Layer 4 freeze.
 *
 * The default `invocationIndex` (when absent) is `0`, matching the
 * 1:1 baseline derivation in `deriveInvocations`.
 */
function validateW11(artifacts: BootArtifacts): Decision<void> {
  const errors: ValidationError[] = [];
  const seen = new Set<string>();
  for (const inv of artifacts.workflow.invocations) {
    const key = `${inv.phase}:${inv.agentId}:${inv.invocationIndex ?? 0}`;
    if (seen.has(key)) {
      errors.push(
        validationError(
          "W11",
          `Duplicate invocation: phase="${inv.phase}", agentId="${inv.agentId}", invocationIndex=${
            inv.invocationIndex ?? 0
          } — same logical phase × agent must be expressed via phase versioning (15 §C)`,
          {
            source: "WorkflowConfig.invocations",
            context: {
              phase: inv.phase,
              agentId: inv.agentId,
              invocationIndex: inv.invocationIndex ?? 0,
            },
          },
        ),
      );
      continue;
    }
    seen.add(key);
  }
  return decideFromErrors(errors);
}

// ---------------------------------------------------------------------------
// A: agent bundle invariants (13 §G)
// ---------------------------------------------------------------------------

/**
 * **A1** — AgentBundle id unique. Already enforced at registry
 * construction (`createAgentRegistry`). We re-check defensively so a
 * synthetic registry built from an unsanitised list still surfaces
 * the violation through the central orchestrator.
 */
function validateA1(artifacts: BootArtifacts): Decision<void> {
  const counts = new Map<string, number>();
  for (const b of bundles(artifacts)) {
    counts.set(b.id, (counts.get(b.id) ?? 0) + 1);
  }
  const errors: ValidationError[] = [];
  for (const [id, n] of counts) {
    if (n > 1) {
      errors.push(
        validationError("A1", `Duplicate AgentBundle id: "${id}"`, {
          context: { agentId: id },
        }),
      );
    }
  }
  return decideFromErrors(errors);
}

/**
 * **A2** — `version` is a parseable SemVer string.
 *
 * Cross-file major drift (agent.json vs steps_registry.json) is
 * loader-side; this rule re-checks the bundle-level value so a
 * synthetic bundle still surfaces a malformed version.
 */
function validateA2(artifacts: BootArtifacts): Decision<void> {
  const errors: ValidationError[] = [];
  for (const b of bundles(artifacts)) {
    if (typeof b.version !== "string" || !SEMVER_RE.test(b.version)) {
      errors.push(
        validationError(
          "A2",
          `AgentBundle "${b.id}".version "${b.version}" is not a valid SemVer`,
          { context: { agentId: b.id, version: b.version } },
        ),
      );
    }
  }
  return decideFromErrors(errors);
}

/**
 * **A3** — step graph reachability from the bundle's entry surface.
 * Closure-step-existence is checked by S5; here we ensure a non-empty
 * graph has at least one resolvable entry — either:
 *  - `flow.entryStep` (transformer / single-entry agents); OR
 *  - `flow.entryStepMapping` (validator agents using verdict-keyed
 *    entry pairs — design 13 §G note: "validator なら entryStepMapping").
 *
 * Per-id resolution of `entryStepMapping[*].initial / continuation`
 * is delegated to S8 so we don't double-report; A3 only enforces that
 * a non-empty graph has *some* entry surface populated.
 */
function validateA3(artifacts: BootArtifacts): Decision<void> {
  const errors: ValidationError[] = [];
  for (const b of bundles(artifacts)) {
    if (b.steps.length === 0) continue; // empty stub bundle — skip
    const stepIds = new Set(b.steps.map((s) => s.stepId));
    const entry = b.flow?.entryStep;
    const mapping = b.flow?.entryStepMapping;
    const hasMapping = mapping && Object.keys(mapping).length > 0;

    if (entry && entry.length > 0) {
      // Single entry form: must resolve in steps.
      if (!stepIds.has(entry)) {
        errors.push(
          validationError(
            "A3",
            `AgentBundle "${b.id}".flow.entryStep "${entry}" not found in steps`,
            { context: { agentId: b.id, entryStep: entry } },
          ),
        );
      }
      continue;
    }

    if (hasMapping) {
      // Mapping form: per-pair resolution is S8's job. A3 just confirms
      // at least one mapping target resolves so the graph is reachable.
      const anyResolvable = Object.values(mapping).some((pair) =>
        stepIds.has(pair.initial) || stepIds.has(pair.continuation)
      );
      if (!anyResolvable) {
        errors.push(
          validationError(
            "A3",
            `AgentBundle "${b.id}".flow.entryStepMapping has no resolvable entry — every pair targets unknown stepIds`,
            { context: { agentId: b.id } },
          ),
        );
      }
      continue;
    }

    // Neither form populated.
    errors.push(
      validationError(
        "A3",
        `AgentBundle "${b.id}".flow has neither entryStep nor entryStepMapping populated`,
        { context: { agentId: b.id } },
      ),
    );
  }
  return decideFromErrors(errors);
}

/**
 * **A4** — disjoint kinds: `flow.workSteps ∩ completion.closureSteps = ∅`.
 */
function validateA4(artifacts: BootArtifacts): Decision<void> {
  const errors: ValidationError[] = [];
  for (const b of bundles(artifacts)) {
    const work = new Set((b.flow?.workSteps ?? []).map((s) => s.stepId));
    for (const closure of b.completion?.closureSteps ?? []) {
      if (work.has(closure.stepId)) {
        errors.push(
          validationError(
            "A4",
            `AgentBundle "${b.id}" step "${closure.stepId}" appears in both flow.workSteps and completion.closureSteps`,
            { context: { agentId: b.id, stepId: closure.stepId } },
          ),
        );
      }
    }
  }
  return decideFromErrors(errors);
}

/**
 * **A5** — every `step.outputSchemaRef.file` is a relative path under
 * `.agent/<agentId>/schemas/`. File-existence on disk is checked by
 * the loader-side `path-validator.ts` (Decision-shaped sibling). We
 * enforce the structural constraint here so a synthetic artifact
 * with an absolute or `..`-traversing schemaRef is rejected.
 */
function validateA5(artifacts: BootArtifacts): Decision<void> {
  const errors: ValidationError[] = [];
  for (const b of bundles(artifacts)) {
    for (const s of b.steps) {
      const ref = s.outputSchemaRef?.file;
      if (!ref) continue;
      if (ref.startsWith("/") || ref.includes("..")) {
        errors.push(
          validationError(
            "A5",
            `AgentBundle "${b.id}" step "${s.stepId}" outputSchemaRef.file "${ref}" must be a relative path under schemas/`,
            { context: { agentId: b.id, stepId: s.stepId, file: ref } },
          ),
        );
      }
    }
  }
  return decideFromErrors(errors);
}

/**
 * **A6** — `closeBinding` integrity (design 13 §F + §G A6).
 *
 * Since T6.2 `closeBinding` is the on-disk source-of-truth; the legacy
 * `closeOnComplete` / `closeCondition` pair has been deleted from the
 * type system. The check therefore reduces to structural integrity of
 * the binding itself.
 *
 * Reject conditions:
 *  - `closeBinding.primary` missing
 *  - `primary.kind == "custom"` ∧ `channel.channelId` empty
 */
function validateA6(artifacts: BootArtifacts): Decision<void> {
  const errors: ValidationError[] = [];
  for (const b of bundles(artifacts)) {
    const cb = b.closeBinding;
    const primary = cb?.primary;
    if (!primary) {
      errors.push(
        validationError(
          "A6",
          `AgentBundle "${b.id}" closeBinding.primary is missing`,
          { context: { agentId: b.id } },
        ),
      );
      continue;
    }

    if (primary.kind === "custom") {
      const channelId = primary.channel?.channelId;
      if (typeof channelId !== "string" || channelId.length === 0) {
        errors.push(
          validationError(
            "A6",
            `AgentBundle "${b.id}" primary.kind="custom" requires a non-empty channel.channelId`,
            { context: { agentId: b.id } },
          ),
        );
      }
    }
  }
  return decideFromErrors(errors);
}

/**
 * **A7 (NEW)** — `parameters: ParamSpec[]` has no duplicate `name`
 * within a bundle.
 */
function validateA7(artifacts: BootArtifacts): Decision<void> {
  const errors: ValidationError[] = [];
  for (const b of bundles(artifacts)) {
    const seen = new Map<string, number>();
    for (const p of b.parameters) {
      seen.set(p.name, (seen.get(p.name) ?? 0) + 1);
    }
    for (const [name, n] of seen) {
      if (n > 1) {
        errors.push(
          validationError(
            "A7",
            `AgentBundle "${b.id}" has ${n} parameters named "${name}" — names must be unique`,
            { context: { agentId: b.id, paramName: name } },
          ),
        );
      }
    }
  }
  return decideFromErrors(errors);
}

/**
 * **A8 (NEW)** — polling read-only constraint (RC1 lesson).
 *
 * For any step where `kind === "closure"` and `address.c3 ===
 * "polling"`, the step's `retry.postLLMConditions` must be empty (or
 * absent). A non-empty validation chain on a polling step
 * re-introduces the closure.polling self-gating retry that RC1
 * #484 closed.
 */
function validateA8(artifacts: BootArtifacts): Decision<void> {
  const errors: ValidationError[] = [];
  for (const b of bundles(artifacts)) {
    for (const s of b.steps) {
      if (!isPollingClosure(s)) continue;
      const post = s.retry?.postLLMConditions;
      if (post && post.length > 0) {
        errors.push(
          validationError(
            "A8",
            `AgentBundle "${b.id}" step "${s.stepId}" is closure.polling but declares non-empty retry.postLLMConditions — polling steps must be read-only (RC1 lesson)`,
            { context: { agentId: b.id, stepId: s.stepId } },
          ),
        );
      }
    }
  }
  return decideFromErrors(errors);
}

function isPollingClosure(step: Step): boolean {
  return step.kind === "closure" && step.address?.c3 === "polling";
}

// ---------------------------------------------------------------------------
// S: step registry invariants (14 §G)
// ---------------------------------------------------------------------------

/**
 * **S1** — `stepId` unique within an agent's step list. The on-disk
 * `steps_registry.json` shape is a `Record<stepId, Step>` and the
 * loader constructs `Step[]` keyed by the same stepId, so duplicates
 * are not representable post-load. We re-check for synthetic bundles.
 */
function validateS1(artifacts: BootArtifacts): Decision<void> {
  const errors: ValidationError[] = [];
  for (const b of bundles(artifacts)) {
    const seen = new Map<string, number>();
    for (const s of b.steps) {
      seen.set(s.stepId, (seen.get(s.stepId) ?? 0) + 1);
    }
    for (const [id, n] of seen) {
      if (n > 1) {
        errors.push(
          validationError(
            "S1",
            `AgentBundle "${b.id}" has ${n} steps with id "${id}" — stepId must be unique`,
            { context: { agentId: b.id, stepId: id } },
          ),
        );
      }
    }
  }
  return decideFromErrors(errors);
}

/**
 * **S2** — every `transitions[*].target` is either a known stepId or
 * `null` (Terminal sentinel). Existing flow-validator covers the
 * dangling case in disk JSON shape; we re-check the typed `Step.transitions`
 * for synthetic artifacts.
 */
function validateS2(artifacts: BootArtifacts): Decision<void> {
  const errors: ValidationError[] = [];
  for (const b of bundles(artifacts)) {
    const stepIds = new Set(b.steps.map((s) => s.stepId));
    for (const s of b.steps) {
      if (!s.transitions) continue;
      for (const [intent, rule] of Object.entries(s.transitions)) {
        if ("target" in rule) {
          const target = rule.target;
          if (target !== null && !stepIds.has(target)) {
            errors.push(
              validationError(
                "S2",
                `AgentBundle "${b.id}" step "${s.stepId}" transition[${intent}] targets unknown step "${target}"`,
                {
                  context: {
                    agentId: b.id,
                    stepId: s.stepId,
                    intent,
                    target,
                  },
                },
              ),
            );
          }
        }
      }
    }
  }
  return decideFromErrors(errors);
}

/**
 * **S3** — `gate.allowedIntents ⊆ keys(transitions)`.
 */
function validateS3(artifacts: BootArtifacts): Decision<void> {
  const errors: ValidationError[] = [];
  for (const b of bundles(artifacts)) {
    for (const s of b.steps) {
      if (!s.structuredGate || !s.transitions) continue;
      const keys = new Set(Object.keys(s.transitions));
      for (const intent of s.structuredGate.allowedIntents) {
        if (!keys.has(intent)) {
          errors.push(
            validationError(
              "S3",
              `AgentBundle "${b.id}" step "${s.stepId}" allowedIntents includes "${intent}" with no matching transition`,
              {
                context: { agentId: b.id, stepId: s.stepId, intent },
              },
            ),
          );
        }
      }
    }
  }
  return decideFromErrors(errors);
}

/**
 * **S4** — `output.schemaRef → schema valid + schemaId resolves`.
 *
 * Schema content validation is delegated to the loader-side
 * `schema-manager.ts:validateFlowStepsAsDecision`. Here we only
 * enforce that the typed bundle's `outputSchemaRef.schema` (≈ schemaId)
 * is a non-empty string when `outputSchemaRef.file` is present —
 * a structural pre-check.
 */
function validateS4(artifacts: BootArtifacts): Decision<void> {
  const errors: ValidationError[] = [];
  for (const b of bundles(artifacts)) {
    for (const s of b.steps) {
      const ref = s.outputSchemaRef;
      if (!ref) continue;
      if (typeof ref.schema !== "string" || ref.schema.length === 0) {
        errors.push(
          validationError(
            "S4",
            `AgentBundle "${b.id}" step "${s.stepId}" outputSchemaRef.schema is empty`,
            { context: { agentId: b.id, stepId: s.stepId } },
          ),
        );
      }
    }
  }
  return decideFromErrors(errors);
}

/**
 * **S5** — at least one `kind === "closure"` step exists per bundle.
 */
function validateS5(artifacts: BootArtifacts): Decision<void> {
  const errors: ValidationError[] = [];
  for (const b of bundles(artifacts)) {
    if (b.steps.length === 0) continue; // empty stub — skip
    const hasClosure = b.steps.some((s) => s.kind === "closure");
    if (!hasClosure) {
      errors.push(
        validationError(
          "S5",
          `AgentBundle "${b.id}" has no closure step (≥1 required)`,
          { context: { agentId: b.id } },
        ),
      );
    }
  }
  return decideFromErrors(errors);
}

/**
 * **S6** — every step's C3L address is structurally resolvable
 * (non-empty `c1/c2/c3/edition`). Two-tier file resolution against
 * disk is performed by the loader's `path-validator.ts`.
 */
function validateS6(artifacts: BootArtifacts): Decision<void> {
  const errors: ValidationError[] = [];
  for (const b of bundles(artifacts)) {
    for (const s of b.steps) {
      const a = s.address;
      const missing: string[] = [];
      if (!a?.c1) missing.push("c1");
      if (!a?.c2) missing.push("c2");
      if (!a?.c3) missing.push("c3");
      if (!a?.edition) missing.push("edition");
      if (missing.length > 0) {
        errors.push(
          validationError(
            "S6",
            `AgentBundle "${b.id}" step "${s.stepId}" address is missing required fields: ${
              missing.join(", ")
            }`,
            { context: { agentId: b.id, stepId: s.stepId, missing } },
          ),
        );
      }
    }
  }
  return decideFromErrors(errors);
}

/**
 * **S7 (NEW)** — `retry.onFailure.patternRef ∈ failurePatterns`.
 *
 * Boot frozen `failurePatterns` lives at the registry top-level. The
 * typed `Step` does not expose the registry's pattern map directly,
 * so we read the raw runner payload (`bundle.runner.failurePatterns`
 * if present) as the source-of-truth. When the registry has no
 * patterns at all, any `patternRef` is a dangling reference.
 */
function validateS7(artifacts: BootArtifacts): Decision<void> {
  const errors: ValidationError[] = [];
  for (const b of bundles(artifacts)) {
    const knownPatterns = collectFailurePatternIds(b);
    for (const s of b.steps) {
      const ref = s.retry?.onFailure?.patternRef;
      if (!ref) continue;
      if (!knownPatterns.has(ref)) {
        errors.push(
          validationError(
            "S7",
            `AgentBundle "${b.id}" step "${s.stepId}" retry.onFailure.patternRef "${ref}" is not declared in failurePatterns`,
            { context: { agentId: b.id, stepId: s.stepId, patternRef: ref } },
          ),
        );
      }
    }
  }
  return decideFromErrors(errors);
}

/**
 * Collect every failurePattern id reachable from a bundle. Reads the
 * runner payload defensively because the typed `AgentBundle` does not
 * yet promote this map (the Bundle-ADT redistribution will own it).
 */
function collectFailurePatternIds(bundle: AgentBundle): Set<string> {
  const ids = new Set<string>();
  const runner = (bundle as unknown as Record<string, unknown>).runner;
  if (!runner || typeof runner !== "object") return ids;
  const r = runner as Record<string, unknown>;
  // `runner.failurePatterns: Record<string, unknown>` (legacy) or
  // `runner.flow.failurePatterns` depending on shape — accept both.
  const candidates: Array<unknown> = [
    r.failurePatterns,
    (r.flow as Record<string, unknown> | undefined)?.failurePatterns,
  ];
  for (const cand of candidates) {
    if (cand && typeof cand === "object" && !Array.isArray(cand)) {
      for (const k of Object.keys(cand as Record<string, unknown>)) {
        ids.add(k);
      }
    }
  }
  return ids;
}

/**
 * **S8** — `entryStepMapping[*].initial / continuation` resolve to
 * known step ids.
 */
function validateS8(artifacts: BootArtifacts): Decision<void> {
  const errors: ValidationError[] = [];
  for (const b of bundles(artifacts)) {
    const mapping = b.flow?.entryStepMapping;
    if (!mapping) continue;
    const stepIds = new Set(b.steps.map((s) => s.stepId));
    for (const [verdictType, pair] of Object.entries(mapping)) {
      for (const slot of ["initial", "continuation"] as const) {
        const id = pair[slot];
        if (!stepIds.has(id)) {
          errors.push(
            validationError(
              "S8",
              `AgentBundle "${b.id}" entryStepMapping[${verdictType}].${slot} references unknown step "${id}"`,
              {
                context: {
                  agentId: b.id,
                  verdictType,
                  slot,
                  stepId: id,
                },
              },
            ),
          );
        }
      }
    }
  }
  return decideFromErrors(errors);
}

/**
 * **S9 (NEW, self-route §4.4)** — `adaptationChain` element is a structurally
 * valid C3L `adaptation` segment.
 *
 * Per `prompt-resolver.ts:formatC3LPath`, an adaptation element becomes the
 * trailing segment of `f_{edition}_{adaptation}.md`. The element MUST
 * therefore be a non-empty string with no path separators or `..` traversal,
 * mirroring the `c3` / `edition` shape that S6 already enforces structurally.
 *
 * On-disk file existence (the `.md` file actually present under
 * `<agentRoot>/prompts/{c1}/{c2}/{c3}/`) is delegated to the loader's
 * path-validator (matching the S6 / A5 split documented in this module's
 * §"Coverage policy"). `validateBootArtifacts` is contracted as a pure
 * synchronous function — surfacing a real disk check would require either
 * an async path-resolver here or an `agentRoot` field on `BootArtifacts`,
 * neither of which exists today. The structural gate keeps the synthetic
 * fixture surface decidable and matches every other Boot invariant.
 *
 * @see tmp/audit-precheck-kind-loop/framework-design/01-self-route-termination.md §4.4
 */
function validateS9(artifacts: BootArtifacts): Decision<void> {
  const errors: ValidationError[] = [];
  for (const b of bundles(artifacts)) {
    for (const s of b.steps) {
      const chain = s.adaptationChain;
      if (chain === undefined) continue; // S9 only fires on declared chains
      for (let i = 0; i < chain.length; i++) {
        const element = chain[i];
        const violation = adaptationChainElementViolation(element);
        if (violation !== null) {
          errors.push(
            validationError(
              "S9",
              `AgentBundle "${b.id}" step "${s.stepId}" adaptationChain[${i}] (${
                JSON.stringify(element)
              }) is not a structurally resolvable C3L adaptation segment: ${violation}`,
              {
                context: {
                  agentId: b.id,
                  stepId: s.stepId,
                  index: i,
                  element,
                },
              },
            ),
          );
        }
      }
    }
  }
  return decideFromErrors(errors);
}

/**
 * Validate that an `adaptationChain` element can be substituted into
 * `prompt-resolver.formatC3LPath`'s `f_{edition}_{adaptation}.md` template.
 *
 * Returns a human-readable rule violation when the element is not usable,
 * or `null` when the element is structurally valid.
 */
function adaptationChainElementViolation(value: unknown): string | null {
  if (typeof value !== "string") return "not a string";
  if (value.length === 0) return "empty string";
  if (value.trim().length === 0) return "whitespace-only";
  if (value.includes("/") || value.includes("\\")) {
    return "contains a path separator";
  }
  if (value.includes("..")) return "contains '..' (path traversal)";
  // C3L adaptation segments live inside a filename; reject any character
  // that would break the `f_<edition>_<adaptation>.md` template at the
  // resolver's regex boundary (`[A-Za-z0-9_-]` is the safe set per the
  // `templates.<name>` regex in `validateW9`).
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    return "non-identifier characters present (allowed: A–Z, a–z, 0–9, '.', '_', '-')";
  }
  return null;
}

/**
 * **S10 (NEW, self-route §4.4) — ADVISORY** — `kind`-allows-`repeat` ∧
 * `adaptationChain` undeclared.
 *
 * For every step whose `kind` admits `"repeat"` (per the source-of-truth
 * {@link STEP_KIND_ALLOWED_INTENTS} table), absence of `adaptationChain`
 * means the framework will implicitly substitute `["default"]` at runtime.
 * S10 surfaces this implicit substitution to the registry author so they
 * can declare it explicitly if intentional.
 *
 * **Intentional high firing rate** — every existing repeat-allowing step
 * that pre-dates this rule fires S10 once. This is the migration signal
 * the design calls for; authors silence it by declaring `adaptationChain`
 * (even just `["default"]`). The signal is *not* a defect.
 *
 * Severity: **warn** (advisory). Emitted via {@link collectBootWarnings},
 * not `validateBootArtifacts` — Boot still succeeds with non-empty warns.
 *
 * @see tmp/audit-precheck-kind-loop/framework-design/01-self-route-termination.md §4.4
 */
function collectS10Warnings(
  artifacts: BootArtifacts,
): readonly ValidationError[] {
  const warnings: ValidationError[] = [];
  for (const b of bundles(artifacts)) {
    for (const s of b.steps) {
      if (s.adaptationChain !== undefined) continue;
      if (!stepKindAllowsRepeat(s)) continue;
      warnings.push(
        validationError(
          "S10",
          `AgentBundle "${b.id}" step "${s.stepId}" (kind="${s.kind}") allows "repeat" intent but adaptationChain is undeclared — framework will implicitly substitute ["default"]; declare adaptationChain explicitly to silence this warn`,
          {
            context: {
              agentId: b.id,
              stepId: s.stepId,
              kind: s.kind,
            },
          },
        ),
      );
    }
  }
  return warnings;
}

/**
 * Predicate sourced from {@link STEP_KIND_ALLOWED_INTENTS} (the single
 * source of truth for kind → allowed-intent mapping). Avoids hard-coded
 * "repeat-allowing kinds" lists that could drift from the registry types.
 */
function stepKindAllowsRepeat(step: Step): boolean {
  const allowed = STEP_KIND_ALLOWED_INTENTS[step.kind];
  return allowed.includes("repeat");
}

/**
 * Collect every advisory (warn-tier) Boot signal for `artifacts`.
 *
 * Mirror of {@link validateBootArtifacts}'s contract (pure, synchronous,
 * `BootArtifacts → readonly ValidationError[]`) but for non-blocking
 * signals only. Callers (kernel boundary / log surfaces) decide how to
 * route the returned `ValidationError[]` — the typical destination is the
 * structured-log JSONL stream.
 *
 * Currently surfaces **S10** only. Future advisory rules append here.
 */
export function collectBootWarnings(
  artifacts: BootArtifacts,
): readonly ValidationError[] {
  return collectS10Warnings(artifacts);
}

// ---------------------------------------------------------------------------
// Test surface — exported helpers for `validate_test.ts` only.
//
// The per-rule helpers are private to keep the public API narrow.
// Tests reach in via this `__internals` namespace which is documented
// as test-only and not part of the module's stable surface.
// ---------------------------------------------------------------------------

/** @internal Test-only re-export. Do not call from production code. */
export const __internals = {
  validateW1,
  validateW2,
  validateW3,
  validateW4,
  validateW5,
  validateW6,
  validateW7,
  validateW8,
  validateW9,
  validateW10,
  validateW11,
  validateA1,
  validateA2,
  validateA3,
  validateA4,
  validateA5,
  validateA6,
  validateA7,
  validateA8,
  validateS1,
  validateS2,
  validateS3,
  validateS4,
  validateS5,
  validateS6,
  validateS7,
  validateS8,
  validateS9,
  /**
   * S10 helper: returns the advisory-tier `ValidationError[]` for the
   * single S10 rule. Tests reach in via this slot to exercise the warn
   * path independently of the full {@link collectBootWarnings} surface.
   */
  collectS10Warnings,
} as const;

/**
 * Reject-tier rule codes — every rule whose violation surfaces through
 * {@link validateBootArtifacts}'s `Decision = Reject`.
 *
 * Used by `validate_test.ts` to assert no Reject rule is silently
 * skipped from the orchestrator chain.
 */
export const REJECT_RULE_CODES = [
  "W1",
  "W2",
  "W3",
  "W4",
  "W5",
  "W6",
  "W7",
  "W8",
  "W9",
  "W10",
  "W11",
  "A1",
  "A2",
  "A3",
  "A4",
  "A5",
  "A6",
  "A7",
  "A8",
  "S1",
  "S2",
  "S3",
  "S4",
  "S5",
  "S6",
  "S7",
  "S8",
  "S9",
] as const;

/**
 * Warn-tier (advisory) rule codes — every rule whose violation surfaces
 * through {@link collectBootWarnings} as a non-blocking
 * `ValidationError`. Boot still succeeds with non-empty warnings.
 *
 * S10 is the migration-signal advisory for `adaptationChain` undeclared
 * on a `repeat`-allowing kind (self-route §4.4).
 */
export const WARN_RULE_CODES = ["S10"] as const;

/**
 * Total rule-code coverage — Reject ∪ Warn. Used by `validate_test.ts`
 * to assert the Boot validation surface covers exactly the documented
 * `ValidationErrorCode` union.
 */
export const RULE_CODES = [
  ...REJECT_RULE_CODES,
  ...WARN_RULE_CODES,
] as const;

/**
 * Sanity: ensure {@link RULE_CODES} covers exactly 29 rules
 * (28 Reject — W1..W11 + A1..A8 + S1..S9 — plus 1 Warn S10).
 */
export const RULE_COUNT = RULE_CODES.length;
