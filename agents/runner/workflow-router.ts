/**
 * WorkflowRouter - Resolves next step from intent and transitions
 *
 * Maps gate interpretation results to concrete step transitions,
 * following the declarative transitions configuration.
 *
 * Enforces intent rules from the Step Flow design:
 * - `closing` intent must target closure.* steps only
 * - `escalate` intent routes to static verification support steps
 *
 * @see agents/docs/design/08_step_flow_design.md
 */

import type {
  PromptStepDefinition,
  StepRegistry,
  TransitionRule,
} from "../common/step-registry.ts";
import {
  inferStepKind,
  STEP_KIND_ALLOWED_INTENTS,
} from "../common/step-registry.ts";
import type { GateInterpretation } from "./step-gate-interpreter.ts";
import { STEP_PHASE } from "../shared/step-phases.ts";

/**
 * Result of routing decision.
 */
export interface RoutingResult {
  /** Next step ID to execute */
  nextStepId: string;
  /** Whether to signal completion (intent was "closing") */
  signalCompletion: boolean;
  /** Reason for routing decision */
  reason: string;
  /** Optional warning message (e.g., handoff from initial step) */
  warning?: string;
}

/**
 * Error thrown when routing fails.
 */
export class RoutingError extends Error {
  public readonly stepId: string;
  public readonly intent: string;
  override readonly cause?: Error;

  constructor(
    message: string,
    stepId: string,
    intent: string,
    cause?: Error,
  ) {
    super(message, { cause });
    this.name = "RoutingError";
    this.stepId = stepId;
    this.intent = intent;
    this.cause = cause;
  }
}

/**
 * WorkflowRouter resolves next step from intent and transitions config.
 *
 * Follows the declarative transitions mapping with sensible defaults.
 */
export class WorkflowRouter {
  constructor(private readonly registry: StepRegistry) {}

  /**
   * Route to next step based on interpretation.
   *
   * Validates intent rules:
   * - Intent must be allowed for the step's stepKind
   * - `closing` intent can only come from closure steps
   * - `escalate` routes to verification support steps
   *
   * @param currentStepId - Current step ID
   * @param interpretation - Gate interpretation result
   * @returns Routing result
   * @throws RoutingError if intent is not allowed for step kind
   */
  route(
    currentStepId: string,
    interpretation: GateInterpretation,
  ): RoutingResult {
    const { intent, target } = interpretation;

    // Validate intent is allowed for step kind
    const stepDef = this.getStepDefinition(currentStepId);
    if (stepDef) {
      this.validateIntentForStepKind(currentStepId, stepDef, intent);
    }

    // Handle terminal intents
    if (intent === "closing") {
      // Only closure steps can emit closing intent - signal completion
      return {
        nextStepId: currentStepId,
        signalCompletion: true,
        reason: interpretation.reason ?? "Intent: closing",
      };
    }

    if (intent === "abort") {
      return {
        nextStepId: currentStepId,
        signalCompletion: true,
        reason: interpretation.reason ?? "Intent: abort",
      };
    }

    // Handle repeat - stay on current step, except for closure steps
    // Per design 08_step_flow_design.md Section 3.2: closure repeat routes to work step via transitions
    if (intent === "repeat") {
      if (stepDef?.c2 === STEP_PHASE.CLOSURE && stepDef.transitions?.repeat) {
        const transitionRule = stepDef.transitions.repeat;
        const resolved = this.resolveTransitionRule(
          transitionRule,
          interpretation,
        );
        if (
          resolved.nextStepId && this.validateStepExists(resolved.nextStepId)
        ) {
          return {
            nextStepId: resolved.nextStepId,
            signalCompletion: false,
            reason: interpretation.reason ??
              `Closure repeat -> ${resolved.nextStepId}`,
          };
        }
      }
      return {
        nextStepId: currentStepId,
        signalCompletion: false,
        reason: interpretation.reason ?? "Intent: repeat",
      };
    }

    // Handle escalate - verification step only, route to support step
    if (intent === "escalate") {
      return this.resolveEscalate(currentStepId, interpretation);
    }

    // Handle handoff - work step transitions to closure step
    // Uses transitions config to route to the appropriate closure step
    if (intent === "handoff") {
      return this.resolveHandoff(currentStepId, interpretation);
    }

    // Handle jump with explicit target
    if (intent === "jump" && target) {
      if (!this.validateStepExists(target)) {
        throw new RoutingError(
          `Target step '${target}' does not exist in registry`,
          currentStepId,
          intent,
        );
      }
      return {
        nextStepId: target,
        signalCompletion: false,
        reason: interpretation.reason ?? `Jump to: ${target}`,
      };
    }

    // For "next" intent, use transitions configuration
    return this.resolveFromTransitions(currentStepId, interpretation);
  }

  /**
   * Resolve next step from transitions configuration.
   *
   * When a transition rule specifies `target: null`, it signals completion.
   * This allows steps to be marked as terminal without relying on implicit behavior.
   */
  private resolveFromTransitions(
    currentStepId: string,
    interpretation: GateInterpretation,
  ): RoutingResult {
    const { intent } = interpretation;
    const stepDef = this.getStepDefinition(currentStepId);

    // Check if step has transitions configured
    if (stepDef?.transitions) {
      const transitionRule = stepDef.transitions[intent];
      if (transitionRule) {
        const resolved = this.resolveTransitionRule(
          transitionRule,
          interpretation,
        );

        // Handle terminal transition (target: null)
        if (resolved.isTerminal) {
          return {
            nextStepId: currentStepId,
            signalCompletion: true,
            reason: interpretation.reason ??
              `Terminal transition: ${intent} -> completion`,
          };
        }

        // Handle normal transition
        if (resolved.nextStepId) {
          if (!this.validateStepExists(resolved.nextStepId)) {
            throw new RoutingError(
              `Transition target '${resolved.nextStepId}' does not exist in registry`,
              currentStepId,
              intent,
            );
          }
          return {
            nextStepId: resolved.nextStepId,
            signalCompletion: false,
            reason: interpretation.reason ??
              `Transition: ${intent} -> ${resolved.nextStepId}`,
          };
        }
      }
    }

    // Fall back to default transition logic
    return this.getDefaultTransition(currentStepId, interpretation);
  }

  /**
   * Result of resolving a transition rule.
   */
  private resolveTransitionRule(
    rule: TransitionRule,
    interpretation: GateInterpretation,
  ): { nextStepId: string | null; isTerminal: boolean } {
    // Simple target rule
    if ("target" in rule) {
      // target: null means terminal step (signal completion)
      if (rule.target === null) {
        return { nextStepId: null, isTerminal: true };
      }
      return { nextStepId: rule.target, isTerminal: false };
    }

    // Conditional rule - evaluate condition against handoff
    if ("condition" in rule && "targets" in rule) {
      const conditionValue = this.evaluateCondition(
        rule.condition,
        interpretation.handoff ?? {},
      );
      const target = rule.targets[conditionValue] ??
        rule.targets["default"] ?? null;
      // target: null in conditional also means terminal
      if (target === null) {
        return { nextStepId: null, isTerminal: true };
      }
      return { nextStepId: target, isTerminal: false };
    }

    return { nextStepId: null, isTerminal: false };
  }

  /**
   * Evaluate a condition expression against handoff data.
   */
  private evaluateCondition(
    condition: string,
    handoff: Record<string, unknown>,
  ): string {
    // Simple case: condition is a variable name
    const value = handoff[condition];
    if (typeof value === "string") {
      return value;
    }
    if (typeof value === "boolean") {
      return value ? "true" : "false";
    }
    if (value !== undefined && value !== null) {
      return String(value);
    }
    return "default";
  }

  /**
   * Get default transition when no explicit transitions configured.
   */
  private getDefaultTransition(
    currentStepId: string,
    interpretation: GateInterpretation,
  ): RoutingResult {
    // Parse step ID components (e.g., "initial.issue" -> ["initial", "issue"])
    const parts = currentStepId.split(".");

    // Default: initial.* -> continuation.*
    if (parts[0] === STEP_PHASE.INITIAL && parts.length >= 2) {
      const continuationStep = `${STEP_PHASE.CONTINUATION}.${
        parts.slice(1).join(".")
      }`;
      if (this.validateStepExists(continuationStep)) {
        return {
          nextStepId: continuationStep,
          signalCompletion: false,
          reason: interpretation.reason ??
            `Default transition: ${currentStepId} -> ${continuationStep}`,
        };
      }
    }

    // If no continuation step, signal completion
    return {
      nextStepId: currentStepId,
      signalCompletion: true,
      reason: interpretation.reason ??
        "No explicit transition or continuation step",
    };
  }

  /**
   * Get step definition from registry.
   */
  private getStepDefinition(stepId: string): PromptStepDefinition | undefined {
    return this.registry.steps[stepId];
  }

  /**
   * Validate that a step exists in the registry.
   */
  private validateStepExists(stepId: string): boolean {
    return stepId in this.registry.steps;
  }

  /**
   * Validate that intent is allowed for the step's kind.
   *
   * @throws RoutingError if intent is not allowed
   */
  private validateIntentForStepKind(
    stepId: string,
    stepDef: PromptStepDefinition,
    intent: string,
  ): void {
    const stepKind = inferStepKind(stepDef);
    if (!stepKind) {
      // Non-flow step (e.g., section.*), skip validation
      return;
    }

    const allowedIntents = STEP_KIND_ALLOWED_INTENTS[stepKind];

    // Note: abort is always allowed (emergency exit)
    if (intent === "abort") {
      return;
    }

    // Check if intent is allowed for this step kind
    if (!allowedIntents.includes(intent as never)) {
      throw new RoutingError(
        `Intent '${intent}' not allowed for ${stepKind} step '${stepId}'. ` +
          `Allowed intents: ${allowedIntents.join(", ")}`,
        stepId,
        intent,
      );
    }
  }

  /**
   * Handle handoff intent for work steps.
   *
   * Handoff transitions to a closure step using the transitions config.
   * Initial steps (initial.*) SHOULD use next/repeat first, but handoff is
   * allowed with a warning per design/08_step_flow_design.md Section 7.3.
   *
   * @throws RoutingError if target doesn't exist
   */
  private resolveHandoff(
    currentStepId: string,
    interpretation: GateInterpretation,
  ): RoutingResult {
    const stepDef = this.getStepDefinition(currentStepId);

    // Warn (but allow) handoff from initial steps per 08_step_flow_design.md Section 7.3:
    // "Runtime logs will warn when handoff is emitted from initial.* step"
    let initialStepWarning: string | undefined;
    if (stepDef?.c2 === STEP_PHASE.INITIAL) {
      initialStepWarning = `Handoff from initial step '${currentStepId}'. ` +
        `Consider using 'next' to proceed to continuation steps first. ` +
        `See design/08_step_flow_design.md Section 7.3.`;
    }

    // Check if handoff transition is defined
    if (stepDef?.transitions?.handoff) {
      const transitionRule = stepDef.transitions.handoff;
      if ("target" in transitionRule) {
        if (transitionRule.target) {
          if (!this.validateStepExists(transitionRule.target)) {
            throw new RoutingError(
              `Handoff target '${transitionRule.target}' does not exist in registry`,
              currentStepId,
              "handoff",
            );
          }
          return {
            nextStepId: transitionRule.target,
            signalCompletion: false,
            reason: interpretation.reason ??
              `Handoff to closure: ${transitionRule.target}`,
            warning: initialStepWarning,
          };
        }
        // target: null means signal completion
        if (transitionRule.target === null) {
          return {
            nextStepId: currentStepId,
            signalCompletion: true,
            reason: interpretation.reason ?? "Handoff: terminal transition",
            warning: initialStepWarning,
          };
        }
      }
    }

    // No transition defined - signal completion for backward compatibility
    return {
      nextStepId: currentStepId,
      signalCompletion: true,
      reason: interpretation.reason ?? "Intent: handoff (no transition)",
      warning: initialStepWarning,
    };
  }

  /**
   * Handle escalate intent for verification steps.
   *
   * Escalate routes to a verification support step, which must be
   * statically defined in the step's transitions.
   *
   * @throws RoutingError if no escalate transition defined
   */
  private resolveEscalate(
    currentStepId: string,
    interpretation: GateInterpretation,
  ): RoutingResult {
    const stepDef = this.getStepDefinition(currentStepId);
    if (!stepDef?.transitions?.escalate) {
      throw new RoutingError(
        `No 'escalate' transition defined for step '${currentStepId}'. ` +
          `Verification steps that use 'escalate' intent must define a transition target.`,
        currentStepId,
        "escalate",
      );
    }

    const transitionRule = stepDef.transitions.escalate;
    if ("target" in transitionRule && transitionRule.target) {
      if (!this.validateStepExists(transitionRule.target)) {
        throw new RoutingError(
          `Escalate target '${transitionRule.target}' does not exist in registry`,
          currentStepId,
          "escalate",
        );
      }
      return {
        nextStepId: transitionRule.target,
        signalCompletion: false,
        reason: interpretation.reason ??
          `Escalate to: ${transitionRule.target}`,
      };
    }

    throw new RoutingError(
      `Invalid 'escalate' transition for step '${currentStepId}'. ` +
        `Must specify a target step.`,
      currentStepId,
      "escalate",
    );
  }
}
