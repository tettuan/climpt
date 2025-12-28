/**
 * @fileoverview LLM-based option resolution for Climpt Agent
 * @module climpt-plugins/skills/delegate-climpt-agent/scripts/options-prompt
 *
 * This module implements the design from:
 * @see tmp/climpt-agent-option-handling-design.md
 *
 * Problem: describe command returns options but they were logged, not used.
 * Solution: Build an LLM prompt to resolve options based on:
 *   - Tier 1: Selection from arrays (edition, adaptation)
 *   - Tier 2: Fixed values (file, destination when true)
 *   - Tier 3: Generate from context (stdin, uv-*)
 *   - Skip: Options with false value
 */

import { query } from "npm:@anthropic-ai/claude-agent-sdk";

import type { CommandWithUV, PromptContext, ResolvedOptions } from "./types.ts";
import type { Logger } from "./logger.ts";

/**
 * Build LLM prompt for option resolution
 *
 * @param command - Command with options and uv definitions
 * @param intent - Detailed user intent for option resolution
 * @param context - Execution context (workingDir, files)
 * @returns Prompt string for LLM
 */
export function buildOptionsPrompt(
  command: CommandWithUV,
  intent: string,
  context: PromptContext,
): string {
  const lines: string[] = [];
  const { options, uv, description, usage } = command;

  // Intent section - detailed user intent
  lines.push("# Build CLI Options");
  lines.push("");
  lines.push("## Intent");
  lines.push(`User intent: "${intent}"`);
  lines.push(
    `Command: ${usage || `${command.c1} ${command.c2} ${command.c3}`}`,
  );
  lines.push(`Purpose: ${description}`);

  // Context section - environment information
  lines.push("");
  lines.push("## Context");
  lines.push(`- Working directory: ${context.workingDir}`);
  if (context.files?.length) {
    lines.push(`- Related files: ${context.files.join(", ")}`);
  }

  // Tier 1: Selection (arrays) - skip if false
  const selections: string[] = [];
  if (options?.edition && Array.isArray(options.edition)) {
    selections.push(`- edition: ${JSON.stringify(options.edition)}`);
  }
  if (options?.adaptation && Array.isArray(options.adaptation)) {
    selections.push(`- adaptation: ${JSON.stringify(options.adaptation)}`);
  }
  if (selections.length > 0) {
    lines.push("");
    lines.push("## Selection Options (choose one from each)");
    lines.push(...selections);
  }

  // Tier 2: Fixed values (only if true, not false)
  // Note: file and destination are OPTIONAL - only include if context provides them
  const fixed: string[] = [];
  if (options?.file === true && context.files?.length) {
    fixed.push(`- file: ${context.files[0]}`);
  }
  // destination is not auto-inferred - only used if explicitly provided in context
  if (fixed.length > 0) {
    lines.push("");
    lines.push("## Fixed Values");
    lines.push(...fixed);
  }

  // Tier 3: Generate (uv-* and stdin) - skip if false
  const generate: string[] = [];
  if (options?.stdin === true) {
    generate.push("- stdin: <generate input content based on intent>");
  }
  if (uv && Array.isArray(uv)) {
    for (const uvItem of uv) {
      for (const [key, desc] of Object.entries(uvItem)) {
        generate.push(`- uv-${key}: ${desc}`);
      }
    }
  }
  if (generate.length > 0) {
    lines.push("");
    lines.push("## Generate from Context");
    lines.push(...generate);
  }

  // Output format instruction
  lines.push("");
  lines.push(
    "Based on the intent and context above, select appropriate options and generate values.",
  );
  lines.push("");
  lines.push("## Output Format");
  lines.push("Return JSON only (no markdown, no explanation):");

  // Build expected JSON structure
  // Note: file and destination are NOT included - they are optional and context-dependent
  const jsonExample: Record<string, string> = {};
  if (options?.edition && Array.isArray(options.edition)) {
    jsonExample["edition"] = "<selected>";
  }
  if (options?.adaptation && Array.isArray(options.adaptation)) {
    jsonExample["adaptation"] = "<selected>";
  }
  if (options?.stdin === true) {
    jsonExample["stdin"] = "<content>";
  }
  if (uv && Array.isArray(uv)) {
    for (const uvItem of uv) {
      for (const key of Object.keys(uvItem)) {
        jsonExample[`uv-${key}`] = "<generated value>";
      }
    }
  }
  lines.push(JSON.stringify(jsonExample, null, 2));

  return lines.join("\n");
}

/**
 * Check if command has options that need LLM resolution
 */
export function needsOptionResolution(command: CommandWithUV): boolean {
  const { options, uv } = command;

  // Check Tier 1: Selection arrays
  if (options?.edition && Array.isArray(options.edition)) return true;
  if (options?.adaptation && Array.isArray(options.adaptation)) return true;

  // Note: file and destination are optional and context-dependent, not auto-resolved

  // Check Tier 3: Generate from context
  if (options?.stdin === true) return true;
  if (uv && Array.isArray(uv) && uv.length > 0) return true;

  return false;
}

/**
 * Extract JSON from LLM response
 *
 * Handles various response formats:
 * - Pure JSON
 * - JSON wrapped in markdown code blocks
 * - JSON with explanatory text before/after
 *
 * @param response - Raw LLM response text
 * @returns Extracted JSON string
 * @throws Error if no valid JSON found
 */
function extractJSON(response: string): string {
  const trimmed = response.trim();

  // Try 1: Extract from markdown code block (```json ... ``` or ``` ... ```)
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // Try 2: Find JSON object by matching braces
  const jsonStart = trimmed.indexOf("{");
  const jsonEnd = trimmed.lastIndexOf("}");
  if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
    return trimmed.slice(jsonStart, jsonEnd + 1);
  }

  // Try 3: Assume the whole response is JSON
  return trimmed;
}

/**
 * Resolve options using LLM
 *
 * @param command - Command with options
 * @param intent - Detailed user intent for option resolution
 * @param context - Execution context
 * @param logger - Logger instance
 * @returns Resolved options as key-value pairs
 */
export async function resolveOptions(
  command: CommandWithUV,
  intent: string,
  context: PromptContext,
  logger: Logger,
): Promise<ResolvedOptions> {
  const prompt = buildOptionsPrompt(command, intent, context);

  await logger.write("Building options prompt for LLM");
  await logger.writeSection("OPTIONS_PROMPT", prompt);

  const queryResult = query({
    prompt,
    options: {
      model: "haiku",
      allowedTools: ["Glob"], // Glob permission for file exploration
      systemPrompt:
        `You are a CLI options resolver. Your task is to resolve CLI option values based on user intent.

RULES:
1. If the intent mentions specific file names or patterns, use Glob to find matching files
2. For test targets: look for test files matching the intent (e.g., **/options-prompt*.test.ts)
3. Return ONLY a valid JSON object matching the requested format
4. Never ask questions - make reasonable decisions based on context
5. If you use Glob, analyze results and pick the most relevant file

After analysis, output ONLY the final JSON object.`,
    },
  });

  let responseText = "";
  try {
    for await (const message of queryResult) {
      if (message.type === "assistant" && message.message.content) {
        for (const block of message.message.content) {
          if (block.type === "text") {
            responseText += block.text;
          }
        }
      }
      // Break after result to prevent iteration error on process exit
      if (message.type === "result") {
        break;
      }
    }
  } catch (error) {
    // If we already got a response, continue with it
    if (!responseText) {
      await logger.writeError("LLM query failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  await logger.write("LLM response received", { response: responseText });

  // Parse JSON response
  try {
    const jsonContent = extractJSON(responseText);
    const resolved = JSON.parse(jsonContent) as ResolvedOptions;
    await logger.write("Options resolved", { resolved });
    return resolved;
  } catch (error) {
    await logger.writeError("Failed to parse LLM response as JSON", {
      response: responseText,
      error: error instanceof Error ? error.message : String(error),
    });
    // Return empty object on parse error - CLI args will be used as fallback
    return {};
  }
}

/**
 * Map option keys to CLI argument names
 * Frontmatter option keys differ from CLI arg names in some cases
 */
const OPTION_TO_CLI_ARG: Record<string, string> = {
  file: "from", // file: true → --from=<path>
  // Other options use the same name: edition, adaptation, destination
};

/**
 * Options that should NOT be converted to CLI args
 * stdin content must be piped to the process, not passed as --stdin=
 */
const SKIP_CLI_ARG_OPTIONS = new Set(["stdin"]);

/**
 * Convert resolved options to CLI arguments
 * Note: stdin is excluded - it must be piped to the process
 */
export function toCLIArgs(resolved: ResolvedOptions): string[] {
  return Object.entries(resolved)
    .filter(([k, v]) => v != null && v !== "" && !SKIP_CLI_ARG_OPTIONS.has(k))
    .map(([k, v]) => {
      const cliArg = OPTION_TO_CLI_ARG[k] || k;
      return `--${cliArg}=${v}`;
    });
}

/**
 * Extract stdin content from resolved options
 * Used when LLM generates stdin content and no piped stdin is available
 */
export function extractStdinFromOptions(
  resolved: ResolvedOptions,
): string | undefined {
  const stdin = resolved["stdin"];
  if (stdin && typeof stdin === "string" && stdin.trim() !== "") {
    return stdin;
  }
  return undefined;
}
