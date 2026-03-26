/**
 * @fileoverview Type definitions for the Help protocol
 * @module mcp/help-types
 *
 * Help is an AI-consumable dialogue protocol for construction guidance.
 * Verbs: describe → scaffold → validate → run (strictly sequential).
 *
 * @see docs/internal/unified-help-concept.md
 */

/**
 * Node in the help graph.
 * Represents a capability, component, or config that can be described,
 * scaffolded, validated, or run.
 */
export interface HelpNode {
  /** Unique identifier (e.g., "agent", "prompt", "component:step-registry") */
  id: string;

  /** Node classification */
  kind: "capability" | "component" | "config";

  /** What this node represents */
  description: string;

  /** Construction spec: what files to create and parameters needed */
  build?: HelpBuild;

  /** Execution spec: only revealed after validate passes */
  run?: HelpRun;

  /** Navigation edges defining valid next queries */
  edges: HelpEdge[];

  /** Cross-file integrity constraints (JSONPath-formalized) */
  constraints?: HelpConstraint[];

  /** Recommended next action */
  next?: HelpNextAction;

  /** Child nodes for 2-tier initial response */
  children?: HelpNode[];

  /** ASCII tree showing the .agent/ directory layout */
  constructionTree?: string;
}

/**
 * Construction specification: files and parameters needed to build this node.
 */
export interface HelpBuild {
  /** File paths with {param} placeholders */
  files: string[];

  /** Parameter descriptions keyed by name */
  params: Record<string, string>;

  /** Resolution context for dynamic references in constraints */
  context?: Record<string, string>;
}

/**
 * Execution specification: how to run what was built.
 */
export interface HelpRun {
  /** CLI command to execute */
  command: string;

  /** JSR endpoint or module path */
  endpoint: string;

  /** Parameter descriptions */
  params: Record<string, string>;

  /** Example invocations */
  examples: string[];
}

/**
 * Directed edge in the help graph.
 */
export interface HelpEdge {
  /** Relationship type */
  rel: "requires" | "produces" | "validates" | "composes";

  /** Target node ID */
  target: string;

  /** Human-readable description of the relationship */
  label: string;

  /** When this edge is relevant */
  when?: string;
}

/**
 * Constraint operator for cross-file integrity checks.
 *
 * Field paths use JSONPath-like notation:
 * - `$.prop` — root property access
 * - `$.a.b.c` — nested property
 * - `$.obj.*` — all values in object
 * - `$.obj.@key` — all keys in object
 * - `$[{ref}]` — dynamic key from sibling field in same iteration context
 * - `(file)` — file existence check
 * - `<pattern>` — content pattern match in file body
 * - `| keys`, `| flatten | unique` — jq-style transforms
 */
export type HelpConstraintOperator =
  | "equals"
  | "contains"
  | "subset_of"
  | "maps_to"
  | "references"
  | "exists"
  | "matches";

/**
 * Cross-file integrity constraint.
 */
export interface HelpConstraint {
  /** Rule identifier (e.g., "R-A1", "PATH-1", "TEMPLATE-2") */
  rule: string;

  /** Source field reference */
  from: { file: string; field: string };

  /** Target field reference */
  to: { file: string; field: string };

  /** How to compare from and to */
  operator: HelpConstraintOperator;

  /** Clarification for edge cases */
  _note?: string;
}

/**
 * Recommended next action in the protocol flow.
 */
export interface HelpNextAction {
  action: "describe" | "scaffold" | "validate";
  target: string;
  params?: Record<string, string>;
}

/**
 * Response from describe() — wraps a HelpNode.
 */
export interface HelpDescribeResult {
  action: "describe";
  target: string;
  result: HelpNode;
}

/**
 * Response from scaffold() — created files and next steps.
 */
export interface HelpScaffoldResult {
  action: "scaffold";
  target: string;
  params: Record<string, string>;
  result: {
    command: string;
    params: Record<string, string>;
    examples: string[];
    created: string[];
    next: HelpNextAction;
  };
}

/**
 * A single constraint violation found during validate().
 */
export interface HelpViolation {
  /** Which constraint rule failed */
  rule: string;

  /** What went wrong */
  message: string;

  /** How to fix it */
  fix: string;
}

/**
 * Response from validate() — passed rules, violations, and optionally run spec.
 */
export interface HelpValidateResult {
  action: "validate";
  target: string;
  params: Record<string, string>;
  result: {
    passed: string[];
    violations: HelpViolation[];
    /** Only present when violations is empty */
    run?: HelpRun;
  };
}

/** Union of all help responses */
export type HelpResult =
  | HelpDescribeResult
  | HelpScaffoldResult
  | HelpValidateResult;

/**
 * Protocol metadata included in root describe() response.
 */
export interface HelpProtocol {
  verbs: string[];
  order: string;
  scope: string;
  operators: Record<string, string>;
  fieldPath: Record<string, string>;
  rules: string[];
  nextActions: string[];
}
