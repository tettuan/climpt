/**
 * Parameter Extractors
 *
 * Extracts parameters from command execution results.
 */

import type { CommandResult, ExtractorType, SemanticParams } from "./types.ts";
import {
  buildGitStatusSemantic,
  parseChangedFiles,
  parseStagedFiles,
  parseUnstagedFiles,
  parseUntrackedFiles,
} from "./extractors/git-status.ts";
import {
  buildTestOutputSemantic,
  getTestErrorOutput,
  parseTestOutput,
} from "./extractors/test-output.ts";
import {
  buildTypeErrorsSemantic,
  extractFiles,
  parseTypeErrors,
} from "./extractors/type-errors.ts";
import { extractLintFiles, parseLintErrors } from "./extractors/lint-errors.ts";
import { generateDiff, parseFormatOutput } from "./extractors/format-check.ts";

/**
 * Parameter extraction function type
 */
type ExtractorFunction = (result: CommandResult) => unknown;

/**
 * Parameter extractor
 */
export class ParamExtractor {
  private extractors: Map<ExtractorType | string, ExtractorFunction>;

  constructor() {
    this.extractors = new Map<ExtractorType | string, ExtractorFunction>([
      // Git extractors
      ["parseChangedFiles", (r) => parseChangedFiles(r.stdout)],
      ["parseUntrackedFiles", (r) => parseUntrackedFiles(r.stdout)],
      ["parseStagedFiles", (r) => parseStagedFiles(r.stdout)],
      ["parseUnstagedFiles", (r) => parseUnstagedFiles(r.stdout)],

      // Test extractors
      ["parseTestOutput", (r) => parseTestOutput(r.stdout, r.stderr)],
      ["failedTests", (r) => parseTestOutput(r.stdout, r.stderr)],
      ["errorOutput", (r) => getTestErrorOutput(r.stdout, r.stderr)],

      // Type error extractors
      ["parseTypeErrors", (r) => parseTypeErrors(r.stderr)],
      ["errors", (r) => parseTypeErrors(r.stderr)],
      ["extractFiles", (r) => extractFiles(r.stdout, r.stderr)],
      ["files", (r) => extractFiles(r.stdout, r.stderr)],

      // Lint extractors
      ["parseLintErrors", (r) => parseLintErrors(r.stdout, r.stderr)],
      ["lintErrors", (r) => parseLintErrors(r.stdout, r.stderr)],
      ["lintFiles", (r) => extractLintFiles(r.stdout, r.stderr)],

      // Format extractors
      ["parseFormatOutput", (r) => parseFormatOutput(r.stdout)],
      ["formatFiles", (r) => parseFormatOutput(r.stdout)],
      ["generateDiff", (r) => generateDiff(r.stdout)],
      ["diff", (r) => generateDiff(r.stdout)],

      // Raw output extractors
      ["stderr", (r) => r.stderr],
      ["stdout", (r) => r.stdout],
      ["exitCode", (r) => r.exitCode],

      // File existence extractors (handled specially in validator)
      ["missingPaths", () => []],
      ["expectedPath", () => ""],
    ]);
  }

  /**
   * Extracts parameters based on configuration
   */
  extract(
    extractConfig: Record<string, ExtractorType | string>,
    result: CommandResult,
  ): Record<string, unknown> {
    const params: Record<string, unknown> = {};

    for (const [paramName, extractorName] of Object.entries(extractConfig)) {
      const extractor = this.extractors.get(extractorName);
      if (extractor) {
        params[paramName] = extractor(result);
      } else {
        // Unknown extractor, try to get raw value
        if (extractorName === "stderr") {
          params[paramName] = result.stderr;
        } else if (extractorName === "stdout") {
          params[paramName] = result.stdout;
        } else {
          params[paramName] = null;
        }
      }
    }

    return params;
  }

  /**
   * Builds semantic context based on which extractors were used
   *
   * Inspects the extractor names in the config to determine which semantic
   * builder to invoke. Returns undefined if no semantic builder matches.
   */
  extractSemantic(
    extractConfig: Record<string, ExtractorType | string>,
    result: CommandResult,
    rawParams: Record<string, unknown>,
  ): SemanticParams | undefined {
    const extractorNames = new Set(Object.values(extractConfig));

    // Git status extractors
    if (
      extractorNames.has("parseChangedFiles") ||
      extractorNames.has("parseUntrackedFiles") ||
      extractorNames.has("parseStagedFiles") ||
      extractorNames.has("parseUnstagedFiles")
    ) {
      return buildGitStatusSemantic(result.stdout, rawParams);
    }

    // Test output extractors
    if (
      extractorNames.has("parseTestOutput") ||
      extractorNames.has("failedTests") ||
      extractorNames.has("errorOutput")
    ) {
      return buildTestOutputSemantic(result.stdout, result.stderr, rawParams);
    }

    // Type error extractors
    if (
      extractorNames.has("parseTypeErrors") ||
      extractorNames.has("errors") ||
      extractorNames.has("extractFiles") ||
      extractorNames.has("files")
    ) {
      return buildTypeErrorsSemantic(result.stderr, rawParams);
    }

    return undefined;
  }

  /**
   * Registers an extractor
   */
  registerExtractor(
    name: string,
    extractor: ExtractorFunction,
  ): void {
    this.extractors.set(name, extractor);
  }

  /**
   * Checks if an extractor exists
   */
  hasExtractor(name: string): boolean {
    return this.extractors.has(name);
  }
}

/**
 * Default ParamExtractor instance
 */
export const defaultParamExtractor = new ParamExtractor();
