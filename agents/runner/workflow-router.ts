/**
 * WorkflowRouter - Resolves next step from intent and transitions
 *
 * Maps gate interpretation results to concrete step transitions,
 * following the declarative transitions configuration.
 */

import type {
  PromptStepDefinition,
  StepRegistry,
  TransitionRule,
} from "../common/step-registry.ts";
import type { GateInterpretation } from "./step-gate-interpreter.ts";

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
 * Follows the declarative transitions mapping while providing
 * sensible defaults for backward compatibility.
 */
export class WorkflowRouter {
  constructor(private readonly registry: StepRegistry) {}

  /**
   * Route to next step based on interpretation.
   *
   * @param currentStepId - Current step ID
   * @param interpretation - Gate interpretation result
   * @returns Routing result
   */
  route(
    currentStepId: string,
    interpretation: GateInterpretation,
  ): RoutingResult {
    const { intent, target } = interpretation;

    // Handle terminal intents
    if (intent === "closing") {
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

    // Handle repeat - stay on current step
    if (intent === "repeat") {
      return {
        nextStepId: currentStepId,
        signalCompletion: false,
        reason: interpretation.reason ?? "Intent: repeat",
      };
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
    if (parts[0] === "initial" && parts.length >= 2) {
      const continuationStep = `continuation.${parts.slice(1).join(".")}`;
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
}
