/**
 * Flow Executor - Step-based Flow Execution
 *
 * Reads flow definition from step registry and executes steps in order.
 * Implements the "instruction over control" philosophy - provides clear
 * step-by-step instructions without enforcing agent behavior.
 *
 * Design Philosophy (from tmp/design-validation-philosophy.md):
 * - Agent behavior is not restricted
 * - What should be done is explicitly instructed
 * - Whether the agent follows instructions is up to the LLM
 * - Graceful degradation when not followed
 *
 * @module
 */

import type {
  StepContext,
  StepDefinition,
  StepRegistry,
} from "../common/step-registry.ts";
import {
  getFlow,
  getFlowSteps,
  getStepDefinition,
  hasFlow,
  loadStepRegistry,
} from "../common/step-registry.ts";

/**
 * Step execution phase
 */
export type StepPhase = "work" | "validate" | "complete";

/**
 * Expanded context for prompt generation
 */
export interface ExpandedContext {
  /** Original step context */
  context: StepContext;
  /** Rendered validator instructions */
  validatorInstructions?: string;
  /** Signal type for completion */
  signalType?: string;
  /** Output format specification */
  format?: string;
}

/**
 * Step execution state
 */
export interface StepExecutionState {
  /** Current step index in the flow */
  currentStepIndex: number;
  /** Current step definition */
  currentStep: StepDefinition | null;
  /** Total steps in the flow */
  totalSteps: number;
  /** Flow name (e.g., "issue", "project") */
  flowName: string;
  /** Whether the flow is complete */
  isFlowComplete: boolean;
}

/**
 * Flow executor configuration
 */
export interface FlowExecutorConfig {
  /** Agent ID for loading registry */
  agentId: string;
  /** Flow mode (e.g., "issue", "project") */
  mode: string;
  /** Base directory for agents (default: "agents") */
  agentsDir?: string;
  /** Custom registry path (optional) */
  registryPath?: string;
  /** Validator instruction templates */
  validatorTemplates?: Record<string, string>;
}

/**
 * Default validator instruction templates
 */
const DEFAULT_VALIDATOR_TEMPLATES: Record<string, string> = {
  "git-clean": `## Git Status Check

1. Run \`git status\` to check for uncommitted changes
2. If there are uncommitted changes:
   - Stage them: \`git add .\`
   - Commit with a descriptive message: \`git commit -m "Your message"\`
3. Run \`git status\` again to confirm "nothing to commit, working tree clean"`,
};

/**
 * Flow Executor
 *
 * Manages flow-based step execution for agents.
 * Reads flow definitions from step registry and provides
 * step-by-step execution with context expansion.
 *
 * @example
 * ```typescript
 * const executor = await FlowExecutor.create({
 *   agentId: "iterator",
 *   mode: "issue",
 * });
 *
 * // Get first step
 * const state = executor.getState();
 * const prompt = await executor.buildStepPrompt(variables);
 *
 * // Advance to next step
 * executor.advanceStep();
 * ```
 */
export class FlowExecutor {
  private readonly registry: StepRegistry;
  private readonly flow: string[];
  private readonly config: FlowExecutorConfig;
  private readonly validatorTemplates: Record<string, string>;
  private currentIndex = 0;

  private constructor(
    registry: StepRegistry,
    flow: string[],
    config: FlowExecutorConfig,
  ) {
    this.registry = registry;
    this.flow = flow;
    this.config = config;
    this.validatorTemplates = config.validatorTemplates ??
      DEFAULT_VALIDATOR_TEMPLATES;
  }

  /**
   * Create a FlowExecutor instance.
   *
   * @param config - Executor configuration
   * @returns Initialized FlowExecutor
   * @throws Error if flow is not defined for the mode
   */
  static async create(config: FlowExecutorConfig): Promise<FlowExecutor> {
    const registryPath = config.registryPath ??
      `.agent/${config.agentId}/steps_registry.json`;

    let registry: StepRegistry;
    try {
      // Try loading from .agent directory first
      registry = await loadStepRegistry(config.agentId, ".", {
        registryPath,
      });
    } catch {
      // Fall back to agents directory
      registry = await loadStepRegistry(
        config.agentId,
        config.agentsDir ?? "agents",
      );
    }

    // Get flow for the specified mode
    const flow = getFlow(registry, config.mode);
    if (!flow || flow.length === 0) {
      throw new Error(
        `No flow defined for mode "${config.mode}" in agent "${config.agentId}"`,
      );
    }

    return new FlowExecutor(registry, flow, config);
  }

  /**
   * Create a FlowExecutor from an existing registry.
   *
   * @param registry - Pre-loaded step registry
   * @param config - Executor configuration
   * @returns Initialized FlowExecutor
   */
  static fromRegistry(
    registry: StepRegistry,
    config: FlowExecutorConfig,
  ): FlowExecutor {
    const flow = getFlow(registry, config.mode);
    if (!flow || flow.length === 0) {
      throw new Error(
        `No flow defined for mode "${config.mode}" in registry`,
      );
    }

    return new FlowExecutor(registry, flow, config);
  }

  /**
   * Get current execution state.
   *
   * @returns Current step execution state
   */
  getState(): StepExecutionState {
    const stepId = this.flow[this.currentIndex];
    const step = stepId ? getStepDefinition(this.registry, stepId) : null;

    return {
      currentStepIndex: this.currentIndex,
      currentStep: step ?? null,
      totalSteps: this.flow.length,
      flowName: this.config.mode,
      isFlowComplete: this.currentIndex >= this.flow.length,
    };
  }

  /**
   * Get current step definition.
   *
   * @returns Current step definition or null if flow is complete
   */
  getCurrentStep(): StepDefinition | null {
    const stepId = this.flow[this.currentIndex];
    if (!stepId) return null;
    return getStepDefinition(this.registry, stepId) ?? null;
  }

  /**
   * Get current step ID.
   *
   * @returns Current step ID or null if flow is complete
   */
  getCurrentStepId(): string | null {
    return this.flow[this.currentIndex] ?? null;
  }

  /**
   * Advance to the next step in the flow.
   *
   * @returns true if advanced, false if already at end
   */
  advanceStep(): boolean {
    if (this.currentIndex >= this.flow.length) {
      return false;
    }
    this.currentIndex++;
    return true;
  }

  /**
   * Reset to the beginning of the flow.
   */
  reset(): void {
    this.currentIndex = 0;
  }

  /**
   * Check if the flow is complete.
   *
   * @returns true if all steps have been executed
   */
  isComplete(): boolean {
    return this.currentIndex >= this.flow.length;
  }

  /**
   * Expand context for the current step.
   *
   * Converts step context into expanded form suitable for prompt generation.
   * This includes rendering validator instructions and format specifications.
   *
   * @returns Expanded context or null if no current step
   */
  expandContext(): ExpandedContext | null {
    const step = this.getCurrentStep();
    if (!step || !step.context) {
      return null;
    }

    const context = step.context;
    const expanded: ExpandedContext = { context };

    // Expand validators
    if (context.validators && Array.isArray(context.validators)) {
      const instructions = context.validators
        .map((v) => this.validatorTemplates[v] ?? `- Validate: ${v}`)
        .join("\n\n");
      expanded.validatorInstructions = instructions;
    }

    // Copy format and signalType
    if (context.format) {
      expanded.format = String(context.format);
    }
    if (context.signalType) {
      expanded.signalType = String(context.signalType);
    }

    return expanded;
  }

  /**
   * Build UV variables for the current step.
   *
   * Includes step-specific variables like validators, format, etc.
   *
   * @param baseVariables - Base variables to merge with
   * @returns Combined UV variables for prompt generation
   */
  buildStepVariables(
    baseVariables: Record<string, string> = {},
  ): Record<string, string> {
    const variables: Record<string, string> = { ...baseVariables };
    const expanded = this.expandContext();

    if (expanded) {
      // Add validator instructions
      if (expanded.validatorInstructions) {
        variables["uv-validator_instructions"] = expanded.validatorInstructions;
      }

      // Add format specification
      if (expanded.format) {
        variables["uv-output_format"] = expanded.format;
      }

      // Add signal type
      if (expanded.signalType) {
        variables["uv-signal_type"] = expanded.signalType;
      }
    }

    // Add step metadata
    const step = this.getCurrentStep();
    if (step) {
      variables["uv-current_step"] = step.stepId;
      variables["uv-current_step_name"] = step.name;
      variables["uv-step_index"] = String(this.currentIndex + 1);
      variables["uv-total_steps"] = String(this.flow.length);
    }

    return variables;
  }

  /**
   * Get all step definitions in the flow.
   *
   * @returns Array of step definitions in execution order
   */
  getFlowSteps(): StepDefinition[] {
    return getFlowSteps(this.registry, this.config.mode);
  }

  /**
   * Get the underlying registry.
   *
   * @returns Step registry
   */
  getRegistry(): StepRegistry {
    return this.registry;
  }

  /**
   * Get the flow step IDs.
   *
   * @returns Array of step IDs in execution order
   */
  getFlowStepIds(): string[] {
    return [...this.flow];
  }

  /**
   * Check if a specific step ID exists in the flow.
   *
   * @param stepId - Step ID to check
   * @returns true if step is in the flow
   */
  hasStep(stepId: string): boolean {
    return this.flow.includes(stepId);
  }

  /**
   * Get step definition by ID.
   *
   * @param stepId - Step ID
   * @returns Step definition or undefined
   */
  getStep(stepId: string): StepDefinition | undefined {
    return getStepDefinition(this.registry, stepId);
  }
}

/**
 * Check if a registry has a flow for a mode.
 *
 * Utility function to check flow availability without loading.
 *
 * @param registry - Step registry
 * @param mode - Mode to check
 * @returns true if flow exists
 */
export function registryHasFlow(registry: StepRegistry, mode: string): boolean {
  return hasFlow(registry, mode);
}

/**
 * Get available flow modes from a registry.
 *
 * @param registry - Step registry
 * @returns Array of mode names
 */
export function getAvailableFlowModes(registry: StepRegistry): string[] {
  return registry.flow ? Object.keys(registry.flow) : [];
}
