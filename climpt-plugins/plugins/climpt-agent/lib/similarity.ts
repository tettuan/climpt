/**
 * @fileoverview Semantic similarity search for commands
 * @module climpt-plugins/climpt-agent/lib/similarity
 *
 * Independent implementation for plugin use.
 * Follows the same specification as MCP server implementation.
 *
 * @see docs/internal/command-operations.md - Search/Describe algorithm specification
 */

import type { Command, SearchResult } from "./types.ts";

/**
 * Calculate cosine similarity between two text strings.
 *
 * Uses word-level cosine similarity:
 * 1. Tokenize both strings (lowercase, split by whitespace)
 * 2. Build vocabulary from unique words
 * 3. Create frequency vectors
 * 4. Calculate cosine similarity
 *
 * @see docs/internal/command-operations.md#アルゴリズム-word-based-cosine-similarity
 *
 * @param a - First text string
 * @param b - Second text string
 * @returns Similarity score (0-1)
 */
export function cosineSimilarity(a: string, b: string): number {
  // Step 1: Tokenize
  const wordsA = a.toLowerCase().split(/\s+/);
  const wordsB = b.toLowerCase().split(/\s+/);

  // Step 2: Build vocabulary
  const allWords = [...new Set([...wordsA, ...wordsB])];

  // Step 3: Create frequency vectors
  const vectorA = allWords.map((word) =>
    wordsA.filter((w) => w === word).length
  );
  const vectorB = allWords.map((word) =>
    wordsB.filter((w) => w === word).length
  );

  // Step 4: Calculate cosine similarity
  const dotProduct = vectorA.reduce((sum, a, i) => sum + a * vectorB[i], 0);
  const magnitudeA = Math.sqrt(vectorA.reduce((sum, a) => sum + a * a, 0));
  const magnitudeB = Math.sqrt(vectorB.reduce((sum, b) => sum + b * b, 0));

  return dotProduct / (magnitudeA * magnitudeB) || 0;
}

/**
 * Search commands by semantic similarity.
 *
 * Searches a list of commands using natural language queries.
 * Uses cosine similarity to rank commands by relevance.
 *
 * @see docs/internal/command-operations.md#search-operation
 *
 * @param commands - Command list to search
 * @param query - Search query in natural language
 * @param topN - Number of results to return (default: 3)
 * @returns Top N most similar commands sorted by score (descending)
 */
export function searchCommands(
  commands: Command[],
  query: string,
  topN = 3,
): SearchResult[] {
  // Deduplicate by c1:c2:c3 key, keep first occurrence
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
    // Build search target: c1 + c2 + c3 + description
    // @see docs/internal/command-operations.md#検索対象テキストの構築
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
 * Get command details by C3L identifiers.
 *
 * Returns all command definitions that match the specified c1, c2, c3.
 * Multiple records may exist for the same combination with different options.
 *
 * @see docs/internal/command-operations.md#describe-operation
 *
 * @param commands - Command list to search
 * @param c1 - Domain identifier
 * @param c2 - Action identifier
 * @param c3 - Target identifier
 * @returns All matching command definitions
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
