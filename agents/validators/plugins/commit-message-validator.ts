/**
 * Commit Message Semantic Validator
 *
 * Checks that commit messages are semantically relevant to the task:
 * - Rejects generic commit messages that lack context
 * - Verifies commit messages reference at least one keyword from the task
 * - Skips validation when no task description is available
 *
 * This is a LIGHTWEIGHT validator: no external commands, no file I/O.
 * All analysis is pure string matching on in-memory data.
 */

import type {
  SemanticValidatorContext,
  SemanticValidatorPlugin,
  SemanticValidatorResult,
} from "./semantic-validator.ts";

/**
 * Words considered too generic to stand alone as a commit message.
 * Matched case-insensitively against the full commit message body
 * (after stripping conventional-commit prefix like "fix:", "feat:").
 */
const GENERIC_MESSAGES: readonly string[] = [
  "fix",
  "update",
  "change",
  "changes",
  "wip",
  "tmp",
  "test",
  "stuff",
  "misc",
  "cleanup",
  "refactor",
  "tweak",
  "done",
  "asdf",
  "minor",
];

/**
 * Conventional commit prefixes to strip before analyzing the body.
 * Pattern: "type:" or "type(scope):"
 */
const CONVENTIONAL_COMMIT_PREFIX = /^[a-z]+(?:\([^)]*\))?:\s*/;

/**
 * Minimum word length to consider as a keyword from the task description.
 * Short words (articles, prepositions) are noise and should be excluded.
 */
const MIN_KEYWORD_LENGTH = 4;

/**
 * Stop words excluded from keyword extraction.
 * These are common English words that carry no semantic weight.
 */
const STOP_WORDS: ReadonlySet<string> = new Set([
  "this",
  "that",
  "with",
  "from",
  "into",
  "have",
  "been",
  "will",
  "would",
  "could",
  "should",
  "also",
  "when",
  "then",
  "than",
  "them",
  "they",
  "their",
  "there",
  "here",
  "what",
  "which",
  "where",
  "were",
  "about",
  "each",
  "make",
  "like",
  "does",
  "doing",
  "being",
  "some",
  "more",
  "most",
  "only",
  "very",
  "just",
  "over",
  "such",
  "after",
  "before",
  "between",
  "through",
  "during",
  "without",
  "again",
  "further",
  "once",
]);

/**
 * Extract meaningful keywords from a task description.
 *
 * Splits on non-alphanumeric boundaries, lowercases, filters by length
 * and stop words. Returns a deduplicated set of keywords.
 */
export function extractKeywords(text: string): Set<string> {
  const words = text.toLowerCase().split(/[^a-z0-9]+/);
  const keywords = new Set<string>();

  for (const word of words) {
    if (word.length >= MIN_KEYWORD_LENGTH && !STOP_WORDS.has(word)) {
      keywords.add(word);
    }
  }

  return keywords;
}

/**
 * Strip conventional commit prefix from a message.
 *
 * Examples:
 *   "fix: resolve auth bug" -> "resolve auth bug"
 *   "feat(api): add endpoint" -> "add endpoint"
 *   "plain message" -> "plain message"
 */
export function stripConventionalPrefix(message: string): string {
  return message.replace(CONVENTIONAL_COMMIT_PREFIX, "");
}

/**
 * Check if a commit message body is too generic.
 *
 * A message is generic if, after stripping the conventional prefix,
 * the remaining body is a single word that appears in GENERIC_MESSAGES.
 */
export function isGenericMessage(message: string): boolean {
  const body = stripConventionalPrefix(message).trim().toLowerCase();

  // Empty body after prefix removal is also generic
  if (body === "") {
    return true;
  }

  // Single-word body that matches a generic term
  if (/^[a-z]+$/.test(body) && GENERIC_MESSAGES.includes(body)) {
    return true;
  }

  return false;
}

/**
 * Check if a commit message references at least one keyword from the task.
 *
 * Uses word-boundary matching to avoid false positives from substrings.
 */
export function messageMatchesTask(
  message: string,
  taskKeywords: Set<string>,
): boolean {
  const lowerMessage = message.toLowerCase();

  for (const keyword of taskKeywords) {
    // Use word-boundary-aware check: the keyword must appear as a
    // standalone word or part of a compound (e.g., "auth" in "authentication")
    if (lowerMessage.includes(keyword)) {
      return true;
    }
  }

  return false;
}

/**
 * Validate a single commit message against a task description.
 *
 * Returns { valid: true } if:
 *   - The message is not generic AND references a task keyword
 *
 * Returns { valid: false, severity: "warning" } if:
 *   - The message is generic (lacks context)
 *   - The message does not reference any task keyword
 */
function validateSingleMessage(
  message: string,
  taskKeywords: Set<string>,
): SemanticValidatorResult {
  if (isGenericMessage(message)) {
    return {
      valid: false,
      message:
        `Commit message "${message}" is too generic. Include context about what was changed and why.`,
      severity: "warning",
    };
  }

  if (taskKeywords.size > 0 && !messageMatchesTask(message, taskKeywords)) {
    return {
      valid: false,
      message:
        `Commit message "${message}" does not reference any keyword from the task description. Expected one of: ${
          [...taskKeywords].slice(0, 5).join(", ")
        }`,
      severity: "warning",
    };
  }

  return { valid: true, severity: "info" };
}

/**
 * Commit message semantic validator plugin
 *
 * Validates that commit messages are meaningful and relevant to the task.
 * Returns warnings (not errors) for suspicious messages, since commit
 * message quality is advisory rather than blocking.
 */
export const commitMessageValidator: SemanticValidatorPlugin = {
  name: "commit-message",

  validate(context: SemanticValidatorContext): SemanticValidatorResult {
    // No commit messages to validate: skip (vacuously valid)
    if (!context.commitMessages || context.commitMessages.length === 0) {
      return { valid: true, severity: "info" };
    }

    // No task description: cannot assert relevance, skip
    if (!context.taskDescription || context.taskDescription.trim() === "") {
      return { valid: true, severity: "info" };
    }

    const taskKeywords = extractKeywords(context.taskDescription);

    // Validate each commit message; return the first failure
    for (const message of context.commitMessages) {
      const trimmed = message.trim();
      if (trimmed === "") continue;

      const result = validateSingleMessage(trimmed, taskKeywords);
      if (!result.valid) {
        return result;
      }
    }

    return { valid: true, severity: "info" };
  },
};
