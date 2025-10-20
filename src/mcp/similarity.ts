/**
 * @fileoverview Semantic similarity search for commands
 *
 * This module provides functions for searching and retrieving commands
 * based on semantic similarity using cosine similarity algorithm.
 *
 * @module mcp/similarity
 */

import type { Command, SearchResult } from "./types.ts";

/**
 * Cosine similarity calculation (word-based)
 *
 * Calculates the similarity between two text strings using word-level
 * cosine similarity. This is a simple but effective method for semantic search.
 *
 * @param a First text string
 * @param b Second text string
 * @returns Similarity score between 0 and 1 (1 = identical, 0 = no similarity)
 *
 * @example
 * ```typescript
 * const score = cosineSimilarity("commit changes", "git commit");
 * console.log(score); // 0.5
 * ```
 */
export function cosineSimilarity(a: string, b: string): number {
  const wordsA = a.toLowerCase().split(/\s+/);
  const wordsB = b.toLowerCase().split(/\s+/);
  const allWords = [...new Set([...wordsA, ...wordsB])];

  const vectorA = allWords.map((word) =>
    wordsA.filter((w) => w === word).length
  );
  const vectorB = allWords.map((word) =>
    wordsB.filter((w) => w === word).length
  );

  const dotProduct = vectorA.reduce((sum, a, i) => sum + a * vectorB[i], 0);
  const magnitudeA = Math.sqrt(vectorA.reduce((sum, a) => sum + a * a, 0));
  const magnitudeB = Math.sqrt(vectorB.reduce((sum, b) => sum + b * b, 0));

  return dotProduct / (magnitudeA * magnitudeB) || 0;
}

/**
 * Search commands by semantic similarity
 *
 * Searches a list of commands using natural language queries.
 * Uses cosine similarity to rank commands by relevance.
 *
 * @param commands Command list to search
 * @param query Search query in English
 * @param topN Number of results to return (default: 3)
 * @returns Top N most similar commands sorted by score (descending)
 *
 * @example
 * ```typescript
 * const results = searchCommands(commands, "commit changes", 3);
 * // Returns: [{ c1: "git", c2: "group-commit", ..., score: 0.424 }, ...]
 * ```
 */
export function searchCommands(
  commands: Command[],
  query: string,
  topN = 3,
): SearchResult[] {
  // Create unique command list (deduplicate by c1+c2+c3, keep first occurrence)
  const uniqueCommands = new Map<string, Command>();
  for (const cmd of commands) {
    const key = `${cmd.c1}:${cmd.c2}:${cmd.c3}`;
    if (!uniqueCommands.has(key)) {
      uniqueCommands.set(key, cmd);
    }
  }

  // Calculate similarity for each unique command
  const results: SearchResult[] = [];
  for (const cmd of uniqueCommands.values()) {
    // Combine c1, c2, c3, and description for search target
    const searchTarget = `${cmd.c1} ${cmd.c2} ${cmd.c3} ${cmd.description}`
      .toLowerCase();
    const score = cosineSimilarity(query, searchTarget);

    results.push({
      c1: cmd.c1,
      c2: cmd.c2,
      c3: cmd.c3,
      description: cmd.description,
      score,
    });
  }

  // Sort by score descending and return top N
  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

/**
 * Describe command by c1, c2, c3
 *
 * Retrieves all command definitions that match the specified c1, c2, c3.
 * Multiple records may exist for the same c1/c2/c3 combination with different options.
 *
 * @param commands Command list to search
 * @param c1 Domain name (e.g., git, spec, test)
 * @param c2 Action name (e.g., create, analyze)
 * @param c3 Target name (e.g., refinement-issue, quality-metrics)
 * @returns All matching command definitions (may be multiple or empty)
 *
 * @example
 * ```typescript
 * const cmds = describeCommand(commands, "git", "group-commit", "unstaged-changes");
 * // Returns: [{ c1: "git", c2: "group-commit", c3: "unstaged-changes", ... }]
 * ```
 */
export function describeCommand(
  commands: Command[],
  c1: string,
  c2: string,
  c3: string,
): Command[] {
  return commands.filter((cmd) =>
    cmd.c1 === c1 && cmd.c2 === c2 && cmd.c3 === c3
  );
}
