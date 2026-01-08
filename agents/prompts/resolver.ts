/**
 * Prompt resolver with Climpt integration
 */

import { join } from "@std/path";
import { DefaultFallbackProvider } from "./fallback.ts";

export interface PromptResolverOptions {
  agentName: string;
  agentDir: string;
  registryPath: string;
  fallbackDir?: string;
}

export interface StepRegistry {
  version: string;
  basePath: string;
  steps: Record<string, StepDefinition>;
  editions?: Record<string, string>;
}

export interface StepDefinition {
  name: string;
  path?: string;
  c1?: string;
  c2?: string;
  c3?: string;
  edition?: string;
  variables?: string[];
  useStdin?: boolean;
}

export class PromptResolver {
  private agentDir: string;
  private registry: StepRegistry;
  private fallbackProvider: DefaultFallbackProvider;

  private constructor(agentDir: string, registry: StepRegistry) {
    this.agentDir = agentDir;
    this.registry = registry;
    this.fallbackProvider = new DefaultFallbackProvider();
  }

  static async create(options: PromptResolverOptions): Promise<PromptResolver> {
    const registryPath = join(options.agentDir, options.registryPath);

    let registry: StepRegistry;
    try {
      const content = await Deno.readTextFile(registryPath);
      registry = JSON.parse(content) as StepRegistry;
    } catch {
      // Use minimal default registry if not found
      registry = {
        version: "1.0.0",
        basePath: "prompts",
        steps: {},
      };
    }

    return new PromptResolver(options.agentDir, registry);
  }

  async resolve(
    stepId: string,
    variables: Record<string, string>,
  ): Promise<string> {
    const step = this.registry.steps[stepId];

    if (!step) {
      // Try fallback provider for known steps
      try {
        return this.fallbackProvider.get(stepId, variables);
      } catch {
        throw new Error(`Unknown step: ${stepId}`);
      }
    }

    // Build path
    const promptPath = step.path ?? this.buildC3LPath(step);
    const fullPath = join(this.agentDir, this.registry.basePath, promptPath);

    // Try Climpt first, then fallback to direct file read
    try {
      return await this.renderWithClimpt(fullPath, variables, step.useStdin);
    } catch {
      try {
        return await this.renderFallback(fullPath, variables);
      } catch {
        // Final fallback to built-in templates
        return this.fallbackProvider.get(stepId, variables);
      }
    }
  }

  async resolveSystemPrompt(
    variables: Record<string, string>,
  ): Promise<string> {
    try {
      return await this.resolve("system", variables);
    } catch {
      // Return a default system prompt
      return this.fallbackProvider.getSystemPrompt(variables);
    }
  }

  private buildC3LPath(step: StepDefinition): string {
    if (!step.c1 || !step.c2 || !step.c3) {
      throw new Error(`Step requires c1, c2, c3 or path`);
    }

    const edition = step.edition ?? "default";
    return join(step.c1, step.c2, step.c3, `f_${edition}.md`);
  }

  private async renderWithClimpt(
    path: string,
    variables: Record<string, string>,
    useStdin?: boolean,
  ): Promise<string> {
    // Build Climpt CLI arguments
    const args = ["--return", path];

    for (const [key, value] of Object.entries(variables)) {
      if (key.startsWith("uv-")) {
        args.push(`--${key}`, value);
      }
    }

    const command = new Deno.Command("climpt", {
      args,
      stdin: useStdin ? "piped" : "null",
      stdout: "piped",
      stderr: "piped",
    });

    const process = command.spawn();

    if (useStdin && variables.input_text) {
      const writer = process.stdin.getWriter();
      await writer.write(new TextEncoder().encode(variables.input_text));
      await writer.close();
    }

    const output = await process.output();

    if (!output.success) {
      const stderr = new TextDecoder().decode(output.stderr);
      throw new Error(`Climpt rendering failed: ${stderr}`);
    }

    return new TextDecoder().decode(output.stdout);
  }

  private async renderFallback(
    path: string,
    variables: Record<string, string>,
  ): Promise<string> {
    const content = await Deno.readTextFile(path);

    // Simple template substitution: {{variable}} and {variable}
    return content
      .replace(/\{\{([^}]+)\}\}/g, (_, key) => {
        const varKey = key.trim();
        return variables[varKey] ?? variables[`uv-${varKey}`] ?? `{{${key}}}`;
      })
      .replace(/\{([^}]+)\}/g, (_, key) => {
        const varKey = key.trim();
        if (varKey.startsWith("uv-")) {
          return variables[varKey] ?? `{${key}}`;
        }
        return variables[`uv-${varKey}`] ?? variables[varKey] ?? `{${key}}`;
      });
  }

  getStepDefinition(stepId: string): StepDefinition | undefined {
    return this.registry.steps[stepId];
  }

  listSteps(): string[] {
    return Object.keys(this.registry.steps);
  }
}
