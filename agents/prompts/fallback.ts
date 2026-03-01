/**
 * Fallback prompt provider that halts agent execution when prompt resolution fails.
 *
 * These templates are NOT functional prompts. They exist solely to surface
 * prompt resolution failures. If any fallback template is rendered, it means
 * the primary prompt resolution pipeline failed to load the correct prompt
 * file from disk. The agent must halt and report the error rather than
 * silently proceeding with degraded instructions.
 */

export interface FallbackPromptProvider {
  get(stepId: string, variables: Record<string, string>): string;
  getSystemPrompt(variables: Record<string, string>): string;
}

export class DefaultFallbackProvider implements FallbackPromptProvider {
  private templates: Record<string, string> = {
    system: `# FALLBACK PROMPT ACTIVATED

**This is a fallback prompt. An error occurred in the prompt resolution process. Do NOT proceed with the task. Halt immediately and report this error.**

## Diagnostic Information

- **Step**: system
- **Agent**: {uv-agent_name}
- **Completion Criteria**: {uv-completion_criteria}

## Required Action

Report this error to the user. Do NOT execute any task instructions. The prompt resolution pipeline failed to load the correct system prompt file from disk.

Possible causes:
1. Prompt file does not exist for this step
2. Step ID format mismatch between handler and registry
3. Registry configuration error
`,

    initial_iterate: `# FALLBACK PROMPT ACTIVATED

**This is a fallback prompt. An error occurred in the prompt resolution process. Do NOT proceed with the task. Halt immediately and report this error.**

## Diagnostic Information

- **Step**: initial_iterate
- **Max Iterations**: {uv-max_iterations}

## Required Action

Report this error to the user. Do NOT execute any task instructions. The prompt resolution pipeline failed to load the correct prompt file from disk.

Possible causes:
1. Prompt file does not exist for this step
2. Step ID format mismatch between handler and registry
3. Registry configuration error
`,

    continuation_iterate: `# FALLBACK PROMPT ACTIVATED

**This is a fallback prompt. An error occurred in the prompt resolution process. Do NOT proceed with the task. Halt immediately and report this error.**

## Diagnostic Information

- **Step**: continuation_iterate
- **Iteration**: {uv-iteration}
- **Max Iterations**: {uv-max_iterations}
- **Remaining**: {uv-remaining}

## Required Action

Report this error to the user. Do NOT execute any task instructions. The prompt resolution pipeline failed to load the correct prompt file from disk.

Possible causes:
1. Prompt file does not exist for this step
2. Step ID format mismatch between handler and registry
3. Registry configuration error
`,

    initial_manual: `# FALLBACK PROMPT ACTIVATED

**This is a fallback prompt. An error occurred in the prompt resolution process. Do NOT proceed with the task. Halt immediately and report this error.**

## Diagnostic Information

- **Step**: initial_manual
- **Topic**: {uv-topic}
- **Completion Keyword**: {uv-completion_keyword}

## Required Action

Report this error to the user. Do NOT execute any task instructions. The prompt resolution pipeline failed to load the correct prompt file from disk.

Possible causes:
1. Prompt file does not exist for this step
2. Step ID format mismatch between handler and registry
3. Registry configuration error
`,

    continuation_manual: `# FALLBACK PROMPT ACTIVATED

**This is a fallback prompt. An error occurred in the prompt resolution process. Do NOT proceed with the task. Halt immediately and report this error.**

## Diagnostic Information

- **Step**: continuation_manual
- **Iteration**: {uv-iteration}
- **Completion Keyword**: {uv-completion_keyword}

## Required Action

Report this error to the user. Do NOT execute any task instructions. The prompt resolution pipeline failed to load the correct prompt file from disk.

Possible causes:
1. Prompt file does not exist for this step
2. Step ID format mismatch between handler and registry
3. Registry configuration error
`,

    initial_issue: `# FALLBACK PROMPT ACTIVATED

**This is a fallback prompt. An error occurred in the prompt resolution process. Do NOT proceed with the task. Halt immediately and report this error.**

## Diagnostic Information

- **Step**: initial_issue
- **Issue Number**: {uv-issue_number}

## Required Action

Report this error to the user. Do NOT execute any task instructions. The prompt resolution pipeline failed to load the correct prompt file from disk.

Possible causes:
1. Prompt file does not exist for this step
2. Step ID format mismatch between handler and registry
3. Registry configuration error
`,

    continuation_issue: `# FALLBACK PROMPT ACTIVATED

**This is a fallback prompt. An error occurred in the prompt resolution process. Do NOT proceed with the task. Halt immediately and report this error.**

## Diagnostic Information

- **Step**: continuation_issue
- **Iteration**: {uv-iteration}
- **Issue Number**: {uv-issue_number}
- **Previous Summary**: {uv-previous_summary}

## Required Action

Report this error to the user. Do NOT execute any task instructions. The prompt resolution pipeline failed to load the correct prompt file from disk.

Possible causes:
1. Prompt file does not exist for this step
2. Step ID format mismatch between handler and registry
3. Registry configuration error
`,

    initial_issue_label_only: `# FALLBACK PROMPT ACTIVATED

**This is a fallback prompt. An error occurred in the prompt resolution process. Do NOT proceed with the task. Halt immediately and report this error.**

## Diagnostic Information

- **Step**: initial_issue_label_only
- **Issue Number**: {uv-issue_number}

## Required Action

Report this error to the user. Do NOT execute any task instructions. The prompt resolution pipeline failed to load the correct prompt file from disk.

Possible causes:
1. Prompt file does not exist for this step
2. Step ID format mismatch between handler and registry
3. Registry configuration error
`,

    continuation_issue_label_only: `# FALLBACK PROMPT ACTIVATED

**This is a fallback prompt. An error occurred in the prompt resolution process. Do NOT proceed with the task. Halt immediately and report this error.**

## Diagnostic Information

- **Step**: continuation_issue_label_only
- **Iteration**: {uv-iteration}
- **Issue Number**: {uv-issue_number}
- **Previous Summary**: {uv-previous_summary}

## Required Action

Report this error to the user. Do NOT execute any task instructions. The prompt resolution pipeline failed to load the correct prompt file from disk.

Possible causes:
1. Prompt file does not exist for this step
2. Step ID format mismatch between handler and registry
3. Registry configuration error
`,

    initial_project: `# FALLBACK PROMPT ACTIVATED

**This is a fallback prompt. An error occurred in the prompt resolution process. Do NOT proceed with the task. Halt immediately and report this error.**

## Diagnostic Information

- **Step**: initial_project
- **Project Number**: {uv-project_number}
- **Phases**: {uv-phases}
- **Current Phase**: {uv-phase}

## Required Action

Report this error to the user. Do NOT execute any task instructions. The prompt resolution pipeline failed to load the correct prompt file from disk.

Possible causes:
1. Prompt file does not exist for this step
2. Step ID format mismatch between handler and registry
3. Registry configuration error
`,

    continuation_project: `# FALLBACK PROMPT ACTIVATED

**This is a fallback prompt. An error occurred in the prompt resolution process. Do NOT proceed with the task. Halt immediately and report this error.**

## Diagnostic Information

- **Step**: continuation_project
- **Iteration**: {uv-iteration}
- **Project Number**: {uv-project_number}
- **Current Phase**: {uv-phase}
- **Previous Summary**: {uv-previous_summary}

## Required Action

Report this error to the user. Do NOT execute any task instructions. The prompt resolution pipeline failed to load the correct prompt file from disk.

Possible causes:
1. Prompt file does not exist for this step
2. Step ID format mismatch between handler and registry
3. Registry configuration error
`,

    continuation_project_preparation: `# FALLBACK PROMPT ACTIVATED

**This is a fallback prompt. An error occurred in the prompt resolution process. Do NOT proceed with the task. Halt immediately and report this error.**

## Diagnostic Information

- **Step**: continuation_project_preparation
- **Iteration**: {uv-iteration}
- **Project Number**: {uv-project_number}

## Required Action

Report this error to the user. Do NOT execute any task instructions. The prompt resolution pipeline failed to load the correct prompt file from disk.

Possible causes:
1. Prompt file does not exist for this step
2. Step ID format mismatch between handler and registry
3. Registry configuration error
`,

    continuation_project_processing: `# FALLBACK PROMPT ACTIVATED

**This is a fallback prompt. An error occurred in the prompt resolution process. Do NOT proceed with the task. Halt immediately and report this error.**

## Diagnostic Information

- **Step**: continuation_project_processing
- **Iteration**: {uv-iteration}
- **Project Number**: {uv-project_number}

## Required Action

Report this error to the user. Do NOT execute any task instructions. The prompt resolution pipeline failed to load the correct prompt file from disk.

Possible causes:
1. Prompt file does not exist for this step
2. Step ID format mismatch between handler and registry
3. Registry configuration error
`,

    continuation_project_review: `# FALLBACK PROMPT ACTIVATED

**This is a fallback prompt. An error occurred in the prompt resolution process. Do NOT proceed with the task. Halt immediately and report this error.**

## Diagnostic Information

- **Step**: continuation_project_review
- **Iteration**: {uv-iteration}
- **Project Number**: {uv-project_number}

## Required Action

Report this error to the user. Do NOT execute any task instructions. The prompt resolution pipeline failed to load the correct prompt file from disk.

Possible causes:
1. Prompt file does not exist for this step
2. Step ID format mismatch between handler and registry
3. Registry configuration error
`,

    initial_structured_signal: `# FALLBACK PROMPT ACTIVATED

**This is a fallback prompt. An error occurred in the prompt resolution process. Do NOT proceed with the task. Halt immediately and report this error.**

## Diagnostic Information

- **Step**: initial_structured_signal
- **Signal Type**: {uv-signal_type}
- **Required Fields**: {uv-required_fields}

## Required Action

Report this error to the user. Do NOT execute any task instructions. The prompt resolution pipeline failed to load the correct prompt file from disk.

Possible causes:
1. Prompt file does not exist for this step
2. Step ID format mismatch between handler and registry
3. Registry configuration error
`,

    continuation_structured_signal: `# FALLBACK PROMPT ACTIVATED

**This is a fallback prompt. An error occurred in the prompt resolution process. Do NOT proceed with the task. Halt immediately and report this error.**

## Diagnostic Information

- **Step**: continuation_structured_signal
- **Iteration**: {uv-iteration}
- **Signal Type**: {uv-signal_type}
- **Previous Summary**: {uv-previous_summary}

## Required Action

Report this error to the user. Do NOT execute any task instructions. The prompt resolution pipeline failed to load the correct prompt file from disk.

Possible causes:
1. Prompt file does not exist for this step
2. Step ID format mismatch between handler and registry
3. Registry configuration error
`,
  };

  get(stepId: string, variables: Record<string, string>): string {
    const template = this.templates[stepId];
    if (!template) {
      throw new Error(`No fallback template for step: ${stepId}`);
    }

    return this.substitute(template, variables);
  }

  getSystemPrompt(variables: Record<string, string>): string {
    return this.substitute(this.templates.system, variables);
  }

  private substitute(
    template: string,
    variables: Record<string, string>,
  ): string {
    return template.replace(/\{([^}]+)\}/g, (match, key) => {
      const value = variables[key] ?? variables[`uv-${key}`];
      return value ?? match;
    });
  }

  /**
   * Add or override a template
   */
  setTemplate(stepId: string, template: string): void {
    this.templates[stepId] = template;
  }

  /**
   * Check if a template exists
   */
  hasTemplate(stepId: string): boolean {
    return stepId in this.templates;
  }
}
