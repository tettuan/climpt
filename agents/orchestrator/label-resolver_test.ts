/**
 * Label Resolver Tests
 *
 * Tests label-to-phase resolution and phase-to-agent resolution
 * with various label combinations, priorities, and phase types.
 */

import { assertEquals } from "@std/assert";
import {
  resolveAgent,
  resolvePhase,
  resolveTerminalOrBlocking,
} from "./label-resolver.ts";
import type { WorkflowConfig } from "./workflow-types.ts";

// =============================================================================
// Test Fixture
// =============================================================================

function createTestConfig(): WorkflowConfig {
  return {
    version: "1.0.0",
    phases: {
      implementation: { type: "actionable", priority: 3, agent: "iterator" },
      review: { type: "actionable", priority: 2, agent: "reviewer" },
      revision: { type: "actionable", priority: 1, agent: "iterator" },
      complete: { type: "terminal" },
      blocked: { type: "blocking" },
    },
    labelMapping: {
      ready: "implementation",
      review: "review",
      "implementation-gap": "revision",
      "from-reviewer": "revision",
      done: "complete",
      blocked: "blocked",
    },
    agents: {
      iterator: {
        role: "transformer",
        directory: "iterator",
        outputPhase: "review",
        fallbackPhase: "blocked",
      },
      reviewer: {
        role: "validator",
        directory: "reviewer",
        outputPhases: {
          approved: "complete",
          rejected: "revision",
        },
        fallbackPhase: "blocked",
      },
    },
    rules: {
      maxCycles: 5,
      cycleDelayMs: 5000,
    },
  };
}

// =============================================================================
// resolvePhase
// =============================================================================

Deno.test("resolvePhase - single label resolves to correct phase", () => {
  const config = createTestConfig();
  const result = resolvePhase(["ready"], config);

  assertEquals(result?.phaseId, "implementation");
  assertEquals(result?.phase.type, "actionable");
  assertEquals(result?.phase.priority, 3);
});

Deno.test("resolvePhase - multiple labels: lowest priority number wins", () => {
  const config = createTestConfig();
  // revision has priority 1, implementation has priority 3
  const result = resolvePhase(["ready", "implementation-gap"], config);

  assertEquals(result?.phaseId, "revision");
  assertEquals(result?.phase.priority, 1);
});

Deno.test("resolvePhase - multiple labels: review (2) beats implementation (3)", () => {
  const config = createTestConfig();
  const result = resolvePhase(["ready", "review"], config);

  assertEquals(result?.phaseId, "review");
  assertEquals(result?.phase.priority, 2);
});

Deno.test("resolvePhase - unknown labels are ignored", () => {
  const config = createTestConfig();
  const result = resolvePhase(["unknown-label", "not-mapped"], config);

  assertEquals(result, null);
});

Deno.test("resolvePhase - terminal phase label returns null", () => {
  const config = createTestConfig();
  const result = resolvePhase(["done"], config);

  assertEquals(result, null);
});

Deno.test("resolvePhase - blocking phase label returns null", () => {
  const config = createTestConfig();
  const result = resolvePhase(["blocked"], config);

  assertEquals(result, null);
});

Deno.test("resolvePhase - no matching labels returns null", () => {
  const config = createTestConfig();
  const result = resolvePhase([], config);

  assertEquals(result, null);
});

Deno.test("resolvePhase - mix of known and unknown labels works", () => {
  const config = createTestConfig();
  // "bug" is unknown, "ready" maps to implementation
  const result = resolvePhase(["bug", "ready", "wontfix"], config);

  assertEquals(result?.phaseId, "implementation");
  assertEquals(result?.phase.priority, 3);
});

Deno.test("resolvePhase - mix of actionable and terminal: only actionable selected", () => {
  const config = createTestConfig();
  // "done" → terminal, "ready" → actionable
  const result = resolvePhase(["done", "ready"], config);

  assertEquals(result?.phaseId, "implementation");
});

Deno.test("resolvePhase - multiple labels mapping to same phase", () => {
  const config = createTestConfig();
  // Both map to revision (priority 1)
  const result = resolvePhase(["implementation-gap", "from-reviewer"], config);

  assertEquals(result?.phaseId, "revision");
  assertEquals(result?.phase.priority, 1);
});

// =============================================================================
// resolvePhase - tiebreaker (same priority)
// =============================================================================

Deno.test("resolvePhase - same priority selects alphabetically smaller phaseId", () => {
  const config = createTestConfig();
  // Add two phases with the same priority
  config.phases["beta"] = {
    type: "actionable",
    priority: 1,
    agent: "iterator",
  };
  config.phases["alpha"] = {
    type: "actionable",
    priority: 1,
    agent: "iterator",
  };
  config.labelMapping["lbl-beta"] = "beta";
  config.labelMapping["lbl-alpha"] = "alpha";

  // beta label comes first, but alpha phaseId should win
  const result = resolvePhase(["lbl-beta", "lbl-alpha"], config);

  assertEquals(result?.phaseId, "alpha");
});

Deno.test("resolvePhase - tiebreaker is deterministic regardless of label order", () => {
  const config = createTestConfig();
  config.phases["beta"] = {
    type: "actionable",
    priority: 1,
    agent: "iterator",
  };
  config.phases["alpha"] = {
    type: "actionable",
    priority: 1,
    agent: "iterator",
  };
  config.labelMapping["lbl-beta"] = "beta";
  config.labelMapping["lbl-alpha"] = "alpha";

  // Reverse label order compared to previous test
  const result = resolvePhase(["lbl-alpha", "lbl-beta"], config);

  assertEquals(result?.phaseId, "alpha");
});

Deno.test("resolvePhase - no priority (Infinity) tiebreak by phaseId", () => {
  const config = createTestConfig();
  // Two phases with no priority field at all
  config.phases["zulu"] = { type: "actionable", agent: "iterator" };
  config.phases["mike"] = { type: "actionable", agent: "iterator" };
  config.labelMapping["lbl-zulu"] = "zulu";
  config.labelMapping["lbl-mike"] = "mike";

  const result = resolvePhase(["lbl-zulu", "lbl-mike"], config);

  assertEquals(result?.phaseId, "mike");
});

// =============================================================================
// resolveAgent
// =============================================================================

Deno.test("resolveAgent - returns correct agent for actionable phase", () => {
  const config = createTestConfig();
  const result = resolveAgent("implementation", config);

  assertEquals(result?.agentId, "iterator");
  assertEquals(result?.agent.role, "transformer");
});

Deno.test("resolveAgent - returns reviewer for review phase", () => {
  const config = createTestConfig();
  const result = resolveAgent("review", config);

  assertEquals(result?.agentId, "reviewer");
  assertEquals(result?.agent.role, "validator");
});

Deno.test("resolveAgent - returns null for terminal phase", () => {
  const config = createTestConfig();
  const result = resolveAgent("complete", config);

  assertEquals(result, null);
});

Deno.test("resolveAgent - returns null for blocking phase", () => {
  const config = createTestConfig();
  const result = resolveAgent("blocked", config);

  assertEquals(result, null);
});

Deno.test("resolveAgent - returns null for unknown phase ID", () => {
  const config = createTestConfig();
  const result = resolveAgent("nonexistent", config);

  assertEquals(result, null);
});

Deno.test("resolveAgent - returns null when phase has no agent", () => {
  const config = createTestConfig();
  // Add a phase with no agent
  config.phases["orphan"] = { type: "actionable", priority: 10 };
  const result = resolveAgent("orphan", config);

  assertEquals(result, null);
});

Deno.test("resolveAgent - returns null when agent ID not in config.agents", () => {
  const config = createTestConfig();
  // Add a phase referencing a non-existent agent
  config.phases["dangling"] = {
    type: "actionable",
    priority: 10,
    agent: "ghost",
  };
  const result = resolveAgent("dangling", config);

  assertEquals(result, null);
});

// =============================================================================
// resolvePhase with labelPrefix
// =============================================================================

Deno.test("resolvePhase - with prefix strips prefix from labels", () => {
  const config = createTestConfig();
  config.labelPrefix = "docs";
  const result = resolvePhase(["docs:ready"], config);

  assertEquals(result?.phaseId, "implementation");
  assertEquals(result?.phase.priority, 3);
});

Deno.test("resolvePhase - with prefix ignores non-prefixed labels", () => {
  const config = createTestConfig();
  config.labelPrefix = "docs";
  // "ready" without prefix should be ignored when prefix is set
  const result = resolvePhase(["ready"], config);

  assertEquals(result, null);
});

Deno.test("resolvePhase - without prefix works as before", () => {
  const config = createTestConfig();
  // No labelPrefix set
  const result = resolvePhase(["ready"], config);

  assertEquals(result?.phaseId, "implementation");
});

Deno.test("resolvePhase - with prefix: priority resolution still works", () => {
  const config = createTestConfig();
  config.labelPrefix = "wf";
  // revision (priority 1) should win over implementation (priority 3)
  const result = resolvePhase(["wf:ready", "wf:implementation-gap"], config);

  assertEquals(result?.phaseId, "revision");
  assertEquals(result?.phase.priority, 1);
});

// =============================================================================
// resolveTerminalOrBlocking
// =============================================================================

Deno.test("resolveTerminalOrBlocking - terminal label returns phase", () => {
  const config = createTestConfig();
  const result = resolveTerminalOrBlocking(["done"], config);

  assertEquals(result?.phaseId, "complete");
  assertEquals(result?.phase.type, "terminal");
});

Deno.test("resolveTerminalOrBlocking - blocking label returns phase", () => {
  const config = createTestConfig();
  const result = resolveTerminalOrBlocking(["blocked"], config);

  assertEquals(result?.phaseId, "blocked");
  assertEquals(result?.phase.type, "blocking");
});

Deno.test("resolveTerminalOrBlocking - actionable label returns null", () => {
  const config = createTestConfig();
  const result = resolveTerminalOrBlocking(["ready"], config);

  assertEquals(result, null);
});

Deno.test("resolveTerminalOrBlocking - unknown label returns null", () => {
  const config = createTestConfig();
  const result = resolveTerminalOrBlocking(["unknown"], config);

  assertEquals(result, null);
});

Deno.test("resolveTerminalOrBlocking - empty labels returns null", () => {
  const config = createTestConfig();
  const result = resolveTerminalOrBlocking([], config);

  assertEquals(result, null);
});

Deno.test("resolveTerminalOrBlocking - mix: terminal found among actionable", () => {
  const config = createTestConfig();
  // "ready" → actionable, "done" → terminal
  const result = resolveTerminalOrBlocking(["ready", "done"], config);

  assertEquals(result?.phaseId, "complete");
  assertEquals(result?.phase.type, "terminal");
});

Deno.test("resolveTerminalOrBlocking - first terminal/blocking wins", () => {
  const config = createTestConfig();
  // "blocked" → blocking, "done" → terminal; blocked comes first
  const result = resolveTerminalOrBlocking(["blocked", "done"], config);

  assertEquals(result?.phaseId, "blocked");
  assertEquals(result?.phase.type, "blocking");
});

Deno.test("resolveTerminalOrBlocking - with prefix strips prefix", () => {
  const config = createTestConfig();
  config.labelPrefix = "wf";
  const result = resolveTerminalOrBlocking(["wf:done"], config);

  assertEquals(result?.phaseId, "complete");
  assertEquals(result?.phase.type, "terminal");
});

Deno.test("resolveTerminalOrBlocking - with prefix ignores non-prefixed", () => {
  const config = createTestConfig();
  config.labelPrefix = "wf";
  const result = resolveTerminalOrBlocking(["done"], config);

  assertEquals(result, null);
});
