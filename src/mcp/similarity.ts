/**
 * @fileoverview BM25-based semantic similarity search for commands
 * @module mcp/similarity
 *
 * **SHARED MODULE** - Used by MCP server, mod.ts exports, and external consumers via JSR.
 *
 * Uses BM25 (Best Match 25) algorithm for better search accuracy:
 * - Reduces weight of common terms (like "create", "get")
 * - Considers document length normalization
 * - Industry-standard search algorithm (used by Elasticsearch, Lucene)
 *
 * @see docs/internal/command-operations.md - Search/Describe algorithm specification
 */

import type { Command, SearchResult } from "./types.ts";

/** BM25 parameters */
const BM25_K1 = 1.2; // Term frequency saturation parameter
const BM25_B = 0.75; // Document length normalization parameter

/**
 * Tokenize text with enhanced splitting for better search accuracy.
 *
 * Splits text on:
 * - Whitespace
 * - Hyphens (group-commit -> group, commit, group-commit)
 * - Underscores (unstaged_changes -> unstaged, changes, unstaged_changes)
 * - CamelCase boundaries (groupCommit -> group, commit, groupcommit)
 *
 * Original compound tokens are preserved to maintain backward compatibility.
 *
 * @param text Input text to tokenize
 * @returns Array of lowercase tokens (deduplicated)
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];

  // Step 1: Split by whitespace first (preserve case for camelCase detection)
  const words = text.split(/\s+/).filter((w) => w.length > 0);

  for (const word of words) {
    const lowerWord = word.toLowerCase();
    tokens.push(lowerWord); // Keep original token (lowercased)

    // Step 2: Split by hyphens
    if (lowerWord.includes("-")) {
      const parts = lowerWord.split("-").filter((p) => p.length > 0);
      tokens.push(...parts);
    }

    // Step 3: Split by underscores
    if (lowerWord.includes("_")) {
      const parts = lowerWord.split("_").filter((p) => p.length > 0);
      tokens.push(...parts);
    }

    // Step 4: Split by camelCase boundaries (must use original case)
    // Match: lowercase followed by uppercase (groupCommit -> group|Commit)
    const camelParts = word.replace(/([a-z])([A-Z])/g, "$1 $2").split(/\s+/);
    if (camelParts.length > 1) {
      tokens.push(...camelParts.map((p) => p.toLowerCase()));
    }
  }

  // Return unique tokens
  return [...new Set(tokens)];
}

/**
 * Internal interface for document statistics used by BM25
 */
interface DocumentStats {
  /** Tokenized document content */
  tokens: string[];
  /** Document length (number of tokens) */
  length: number;
  /** Term frequency map: term -> count */
  termFreq: Map<string, number>;
}

/**
 * Internal interface for corpus-level statistics used by BM25
 */
interface CorpusStats {
  /** Total number of documents */
  numDocs: number;
  /** Average document length */
  avgDocLength: number;
  /** Document frequency: term -> number of documents containing the term */
  docFreq: Map<string, number>;
  /** Per-document statistics */
  docStats: DocumentStats[];
}

/**
 * Build corpus statistics for BM25 scoring
 *
 * @param documents Array of document texts
 * @returns Corpus statistics including IDF values
 */
function buildCorpusStats(documents: string[]): CorpusStats {
  const docStats: DocumentStats[] = [];
  const docFreq = new Map<string, number>();
  let totalLength = 0;

  for (const doc of documents) {
    const tokens = tokenize(doc);
    const termFreq = new Map<string, number>();

    // Count term frequencies in this document
    for (const token of tokens) {
      termFreq.set(token, (termFreq.get(token) || 0) + 1);
    }

    // Update document frequency (how many docs contain each term)
    const uniqueTerms = new Set(tokens);
    for (const term of uniqueTerms) {
      docFreq.set(term, (docFreq.get(term) || 0) + 1);
    }

    docStats.push({
      tokens,
      length: tokens.length,
      termFreq,
    });

    totalLength += tokens.length;
  }

  return {
    numDocs: documents.length,
    avgDocLength: documents.length > 0 ? totalLength / documents.length : 0,
    docFreq,
    docStats,
  };
}

/**
 * Calculate IDF (Inverse Document Frequency) for a term
 *
 * Uses the BM25 IDF formula:
 * IDF(t) = log((N - df(t) + 0.5) / (df(t) + 0.5) + 1)
 *
 * @param term The term to calculate IDF for
 * @param corpus Corpus statistics
 * @returns IDF value (higher = rarer term = more important)
 */
function calculateIDF(term: string, corpus: CorpusStats): number {
  const df = corpus.docFreq.get(term) || 0;
  const N = corpus.numDocs;

  // BM25 IDF formula with +1 to ensure non-negative values
  return Math.log((N - df + 0.5) / (df + 0.5) + 1);
}

/**
 * Calculate BM25 score for a query against a document
 *
 * BM25 formula:
 * score(D, Q) = SUM IDF(qi) * (f(qi, D) * (k1 + 1)) / (f(qi, D) + k1 * (1 - b + b * |D| / avgdl))
 *
 * @param queryTokens Tokenized query
 * @param docStats Document statistics
 * @param corpus Corpus statistics
 * @returns BM25 score (higher = more relevant)
 */
function calculateBM25Score(
  queryTokens: string[],
  docStats: DocumentStats,
  corpus: CorpusStats,
): number {
  let score = 0;

  for (const term of queryTokens) {
    const idf = calculateIDF(term, corpus);
    const tf = docStats.termFreq.get(term) || 0;

    if (tf === 0) continue;

    // BM25 term score
    const numerator = tf * (BM25_K1 + 1);
    const denominator = tf +
      BM25_K1 * (1 - BM25_B + BM25_B * docStats.length / corpus.avgDocLength);

    score += idf * (numerator / denominator);
  }

  return score;
}

/**
 * Search commands by semantic similarity using BM25
 *
 * Searches a list of commands using natural language queries.
 * Uses BM25 algorithm to rank commands by relevance.
 *
 * BM25 advantages over cosine similarity:
 * - Common terms (like "create", "get") are weighted lower (via IDF)
 * - Document length is normalized
 * - Industry-standard algorithm used by major search engines
 *
 * @param commands Command list to search
 * @param query Search query in English
 * @param topN Number of results to return (default: 3)
 * @returns Top N most similar commands sorted by score (descending)
 *
 * @example
 * ```typescript
 * const results = searchCommands(commands, "create specification", 3);
 * // Returns: [{ c1: "requirements", c2: "draft", c3: "entry", ..., score: 1.234 }, ...]
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

  // Build document corpus from commands
  const commandList = Array.from(uniqueCommands.values());
  const documents = commandList.map((cmd) =>
    `${cmd.c1} ${cmd.c2} ${cmd.c3} ${cmd.description}`.toLowerCase()
  );

  // Build corpus statistics for BM25
  const corpus = buildCorpusStats(documents);

  // Tokenize query
  const queryTokens = tokenize(query.toLowerCase());

  // Calculate BM25 score for each command
  const results: SearchResult[] = commandList.map((cmd, index) => ({
    c1: cmd.c1,
    c2: cmd.c2,
    c3: cmd.c3,
    description: cmd.description,
    score: calculateBM25Score(queryTokens, corpus.docStats[index], corpus),
  }));

  // Sort by score descending and return top N
  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

/**
 * RRF (Reciprocal Rank Fusion) result interface
 */
export interface RRFResult {
  c1: string;
  c2: string;
  c3: string;
  description: string;
  /** RRF aggregated score */
  score: number;
  /** Rank per query (1-indexed, -1 if not found) */
  ranks: number[];
}

/** RRF smoothing parameter (standard value from literature) */
const RRF_K = 60;

/**
 * Search commands using RRF (Reciprocal Rank Fusion) with multiple queries.
 *
 * RRF combines rankings from multiple search queries using the formula:
 *   score(d) = SUM 1/(k + rank_i(d))
 *
 * This is useful for C3L-aligned dual queries:
 * - query1: Action-focused (emphasizes c2 - what to do)
 * - query2: Target-focused (emphasizes c3 - what to act on)
 *
 * @param commands Command list to search
 * @param queries Array of search queries (typically 2: action + target)
 * @param topN Number of results to return (default: 3)
 * @returns Top N commands sorted by RRF score (descending)
 *
 * @example
 * ```typescript
 * const results = searchWithRRF(commands, [
 *   "draft create write compose",      // action-focused
 *   "specification document entry"     // target-focused
 * ], 3);
 * ```
 */
export function searchWithRRF(
  commands: Command[],
  queries: string[],
  topN = 3,
): RRFResult[] {
  if (queries.length === 0) {
    return [];
  }

  // Map: command key -> { score, ranks, cmd }
  const rrfScores = new Map<
    string,
    { score: number; ranks: number[]; cmd: SearchResult }
  >();

  // Process each query and accumulate RRF scores
  for (let qIdx = 0; qIdx < queries.length; qIdx++) {
    const query = queries[qIdx];
    if (!query || query.trim() === "") {
      continue;
    }

    // Get all results for this query (use full command list)
    const results = searchCommands(commands, query, commands.length);

    for (let rank = 0; rank < results.length; rank++) {
      const r = results[rank];
      const key = `${r.c1}:${r.c2}:${r.c3}`;

      // Get or create entry
      let existing = rrfScores.get(key);
      if (!existing) {
        existing = {
          score: 0,
          ranks: new Array(queries.length).fill(-1),
          cmd: r,
        };
        rrfScores.set(key, existing);
      }

      // RRF formula: 1/(k + rank), where rank is 1-indexed
      existing.score += 1 / (RRF_K + rank + 1);
      existing.ranks[qIdx] = rank + 1; // Store 1-indexed rank
    }
  }

  // Sort by RRF score and return top N
  return [...rrfScores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map(({ score, ranks, cmd }) => ({
      c1: cmd.c1,
      c2: cmd.c2,
      c3: cmd.c3,
      description: cmd.description,
      score,
      ranks,
    }));
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
