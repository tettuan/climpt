/**
 * ValidationError ADT — file-prefix variants W1..W11 / A1..A8 / S1..S8.
 *
 * Defines the unified error shape returned by the Boot validation layer.
 * Each rule is identified by a `code` discriminator that maps to a
 * specific design rule in the realistic-design docs (12 §F / 13 §G /
 * 14 §G).
 *
 * Design refs:
 *  - `agents/docs/design/realistic/12-workflow-config.md` §F  (W1..W11)
 *  - `agents/docs/design/realistic/13-agent-config.md`     §G  (A1..A8)
 *  - `agents/docs/design/realistic/14-step-registry.md`    §G  (S1..S8)
 *
 * @module
 */

/**
 * Discriminator codes for `ValidationError`.
 *
 * - `W1..W11` — workflow.json (12 §F).
 * - `A1..A8`  — agent bundle (13 §G).
 * - `S1..S8`  — step registry (14 §G).
 */
export type ValidationErrorCode =
  // ---- W: workflow.json (12 §F) ------------------------------------------
  | "W1" //  PhaseDecl integrity (PhaseId unique, kind enumerated)
  | "W2" //  invocations[*].phase ∈ phases
  | "W3" //  invocations[*].agent ∈ AgentBundle list
  | "W4" //  invocations[*].nextPhase reference ∈ phases
  | "W5" //  labelMapping value ∈ phases
  | "W6" //  projectBinding.{donePhase,evalPhase,planPhase} ∈ phases
  | "W7" //  issueSource × Policy.ghBinary integrity
  | "W8" //  prioritizer.agent ∈ AgentBundle list
  | "W9" //  handoffTemplate id ∈ handoff.commentTemplates
  | "W10" // Transport pair integrity (RR / RF / FF / Mock×File)
  | "W11" // invocations[] (phase, agentId, invocationIndex) unique
  // ---- A: agent bundle (13 §G) -------------------------------------------
  | "A1" //  AgentId unique
  | "A2" //  SemVer valid + major drift
  | "A3" //  step graph reachability (entryStep → terminal)
  | "A4" //  disjoint kinds (workSteps ∩ closureSteps = ∅)
  | "A5" //  schemaRef.file existence under .agent/<id>/schemas/
  | "A6" //  closeBinding integrity            (TODO[T2.2] — no validator yet)
  | "A7" //  ParamSpec name unique             (TODO[T2.2] — partial)
  | "A8" //  polling read-only constraint      (TODO[T2.2] — no validator yet)
  // ---- S: step registry (14 §G) ------------------------------------------
  | "S1" //  stepId unique
  | "S2" //  transition target ∈ steps ∪ Terminal
  | "S3" //  gate.allowedIntents ⊆ keys(transitions)
  | "S4" //  output.schemaRef → schema valid + schemaId resolves
  | "S5" //  ≥1 closure step exists
  | "S6" //  address → prompt file resolves (two-tier)
  | "S7" //  retry.patternRef ∈ failurePatterns (TODO[T2.2] — partial)
  | "S8"; //  entryStepMapping.* ∈ steps

/**
 * Single validation failure record.
 *
 * `code` is the structural discriminator (see {@link ValidationErrorCode}).
 * `message` is the human-readable diagnostic — typically the same string
 * the legacy `ValidationResult.errors[]` emitted, preserved for parity.
 * `source` and `context` are optional and meant for diagnostics: they
 * carry the file path and arbitrary key-value debug data without
 * complicating the discriminator.
 */
export interface ValidationError {
  readonly code: ValidationErrorCode;
  readonly message: string;
  readonly source?: string;
  readonly context?: Readonly<Record<string, unknown>>;
}

/**
 * Construct a {@link ValidationError}.
 */
export function validationError(
  code: ValidationErrorCode,
  message: string,
  opts?: {
    readonly source?: string;
    readonly context?: Readonly<Record<string, unknown>>;
  },
): ValidationError {
  return {
    code,
    message,
    source: opts?.source,
    context: opts?.context,
  };
}
