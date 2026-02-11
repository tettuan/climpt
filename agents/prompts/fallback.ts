/**
 * Fallback prompt provider for when Climpt is unavailable
 */

export interface FallbackPromptProvider {
  get(stepId: string, variables: Record<string, string>): string;
  getSystemPrompt(variables: Record<string, string>): string;
}

export class DefaultFallbackProvider implements FallbackPromptProvider {
  private templates: Record<string, string> = {
    // System prompt
    system: `# {uv-agent_name} Agent

You are operating as the **{uv-agent_name}** agent.

## Completion Criteria

{uv-completion_criteria}

## Guidelines

- Think step by step
- Report progress regularly
- Ask for clarification when needed
- Follow the completion criteria closely

## Note

This is a fallback system prompt. After completing your task, tell the user to create a \`prompts/system.md\` file with a role-specific system prompt tailored to this agent.
`,

    // Iterate completion type
    initial_iterate: `# Task Start

This task will run for up to **{uv-max_iterations}** iterations.

Begin iteration 1. Make progress and report what you accomplished.
`,

    continuation_iterate: `# Iteration {uv-iteration} of {uv-max_iterations}

**Remaining iterations:** {uv-remaining}

Continue making progress. Report what you accomplished this iteration.
`,

    // Manual completion type
    initial_manual: `# Session Start

## Topic
{uv-topic}

Begin the session. When complete, output \`{uv-completion_keyword}\`.
`,

    continuation_manual: `# Continuation (Iteration {uv-iteration})

Continue the session.

When complete, output \`{uv-completion_keyword}\`.
`,

    // Issue completion type
    initial_issue: `# GitHub Issue #{uv-issue_number}

Work on completing the requirements in Issue #{uv-issue_number}.

Review the issue, understand the requirements, and begin implementation.

When all requirements are satisfied, close the issue using \`gh issue close {uv-issue_number}\`.
`,

    continuation_issue: `# Continuation (Iteration {uv-iteration})

Continue working on Issue #{uv-issue_number}.

{uv-previous_summary}

When all requirements are satisfied, close the issue.
`,

    // Project completion type
    initial_project: `# GitHub Project #{uv-project_number}

Work through the project phases: {uv-phases}

Current phase: **{uv-phase}**

Begin working on the current phase.
`,

    continuation_project: `# Project Continuation (Iteration {uv-iteration})

Project #{uv-project_number} - Phase: **{uv-phase}**

{uv-previous_summary}

Continue working on the current phase. When ready, move to the next phase.
`,

    continuation_project_preparation:
      `# Preparation Phase (Iteration {uv-iteration})

Project #{uv-project_number}

Continue the preparation phase:
- Gather requirements
- Set up environment
- Plan the work

When ready, indicate "Moving to processing" to advance.
`,

    continuation_project_processing:
      `# Processing Phase (Iteration {uv-iteration})

Project #{uv-project_number}

Continue the main implementation work.

When ready, indicate "Moving to review" to advance.
`,

    continuation_project_review: `# Review Phase (Iteration {uv-iteration})

Project #{uv-project_number}

Review and validate the work:
- Test the changes
- Review code quality
- Document as needed

When ready, indicate "Phase: complete" to finish.
`,

    // Structured signal completion type
    initial_structured_signal: `# Task Start

Work on the assigned task. When complete, output a structured completion signal.

## Completion Signal Type
{uv-signal_type}

## Required Fields
{uv-required_fields}

Do not output the completion signal until you have verified the task is done.
`,

    continuation_structured_signal: `# Continuation (Iteration {uv-iteration})

{uv-previous_summary}

Continue working on the task.

When complete, output the structured signal of type: {uv-signal_type}
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
