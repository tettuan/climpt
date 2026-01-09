/**
 * Coordination Config Tests
 *
 * Tests for the coordination configuration system.
 * Phase 4: Validation and CI integration.
 */

import { assertEquals, assertMatch } from "@std/assert";
import {
  generateCorrelationId,
  getLabel,
  loadCoordinationConfig,
  renderHandoffComment,
} from "./coordination.ts";

// ============================================================================
// loadCoordinationConfig tests
// ============================================================================

Deno.test("loadCoordinationConfig - loads default config", () => {
  const config = loadCoordinationConfig();

  assertEquals(config.version, "1.0.0");
  assertEquals(config.labels.requirements, "docs");
  assertEquals(config.labels.review, "review");
  assertEquals(config.labels.gap, "implementation-gap");
  assertEquals(config.labels.fromReviewer, "from-reviewer");
  assertEquals(config.labels.feedback, "need clearance");
});

Deno.test("loadCoordinationConfig - handoff templates exist", () => {
  const config = loadCoordinationConfig();

  assertEquals(
    typeof config.handoff.iteratorToReviewer.commentTemplate,
    "string",
  );
  assertEquals(
    typeof config.handoff.reviewerToIterator.issueTemplate.titlePrefix,
    "string",
  );
  assertEquals(
    Array.isArray(config.handoff.reviewerToIterator.issueTemplate.labels),
    true,
  );
});

Deno.test("loadCoordinationConfig - retry config exists", () => {
  const config = loadCoordinationConfig();

  assertEquals(typeof config.retry.maxAttempts, "number");
  assertEquals(typeof config.retry.delayMs, "number");
  assertEquals(typeof config.retry.backoffMultiplier, "number");
  assertEquals(config.retry.maxAttempts, 3);
  assertEquals(config.retry.delayMs, 1000);
  assertEquals(config.retry.backoffMultiplier, 2);
});

Deno.test("loadCoordinationConfig - orchestration config exists", () => {
  const config = loadCoordinationConfig();

  assertEquals(typeof config.orchestration.maxCycles, "number");
  assertEquals(typeof config.orchestration.cycleDelayMs, "number");
  assertEquals(typeof config.orchestration.autoTrigger, "boolean");
  assertEquals(config.orchestration.maxCycles, 5);
  assertEquals(config.orchestration.cycleDelayMs, 5000);
  assertEquals(config.orchestration.autoTrigger, false);
});

Deno.test("loadCoordinationConfig - traceability config exists", () => {
  const config = loadCoordinationConfig();

  assertEquals(typeof config.traceability.idFormat, "string");
  assertEquals(typeof config.traceability.requireInGapIssues, "boolean");
  assertEquals(config.traceability.idFormat, "req:{category}:{name}#{date}");
  assertEquals(config.traceability.requireInGapIssues, true);
});

Deno.test("loadCoordinationConfig - applies overrides", () => {
  const config = loadCoordinationConfig({
    labels: {
      requirements: "custom-docs",
      review: "custom-review",
      gap: "custom-gap",
      fromReviewer: "custom-from-reviewer",
      feedback: "custom-feedback",
    },
  });

  assertEquals(config.labels.requirements, "custom-docs");
  assertEquals(config.labels.review, "custom-review");
  assertEquals(config.labels.gap, "custom-gap");
  // Version should remain unchanged
  assertEquals(config.version, "1.0.0");
});

// ============================================================================
// getLabel tests
// ============================================================================

Deno.test("getLabel - returns correct label", () => {
  const config = loadCoordinationConfig();

  assertEquals(getLabel(config, "requirements"), "docs");
  assertEquals(getLabel(config, "review"), "review");
  assertEquals(getLabel(config, "gap"), "implementation-gap");
  assertEquals(getLabel(config, "fromReviewer"), "from-reviewer");
  assertEquals(getLabel(config, "feedback"), "need clearance");
});

// ============================================================================
// renderHandoffComment tests
// Note: Template uses {variable} format, not {{variable}}
// ============================================================================

Deno.test("renderHandoffComment - substitutes single variable", () => {
  const template = "Issue #{issueNumber} is ready for review";
  const result = renderHandoffComment(template, { issueNumber: "123" });

  assertEquals(result, "Issue #123 is ready for review");
});

Deno.test("renderHandoffComment - substitutes multiple variables", () => {
  const template = "{agent} completed {count} tasks on {date}";
  const result = renderHandoffComment(template, {
    agent: "iterator",
    count: "5",
    date: "2025-01-08",
  });

  assertEquals(result, "iterator completed 5 tasks on 2025-01-08");
});

Deno.test("renderHandoffComment - handles missing variables", () => {
  const template = "Hello {name}, your score is {score}";
  const result = renderHandoffComment(template, { name: "Alice" });

  // Missing variables should remain as placeholders
  assertEquals(result, "Hello Alice, your score is {score}");
});

Deno.test("renderHandoffComment - handles empty template", () => {
  const result = renderHandoffComment("", { key: "value" });
  assertEquals(result, "");
});

Deno.test("renderHandoffComment - handles template without variables", () => {
  const template = "No variables here";
  const result = renderHandoffComment(template, { key: "value" });

  assertEquals(result, "No variables here");
});

// ============================================================================
// generateCorrelationId tests
// Format: coord-{timestamp}-{agent}
// where timestamp is ISO format with : and . replaced by -
// ============================================================================

Deno.test("generateCorrelationId - generates iterator ID", () => {
  const config = loadCoordinationConfig();
  const id = generateCorrelationId(config, "iterator");

  // Format: coord-YYYY-MM-DDTHH-MM-SS-MMMZ-iterator
  assertMatch(
    id,
    /^coord-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-iterator$/,
  );
});

Deno.test("generateCorrelationId - generates reviewer ID", () => {
  const config = loadCoordinationConfig();
  const id = generateCorrelationId(config, "reviewer");

  // Format: coord-YYYY-MM-DDTHH-MM-SS-MMMZ-reviewer
  assertMatch(
    id,
    /^coord-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-reviewer$/,
  );
});

Deno.test("generateCorrelationId - IDs are unique", async () => {
  const config = loadCoordinationConfig();

  // Generate IDs with staggered delays to ensure unique timestamps
  // Using Promise.all with explicit delay offsets to avoid no-await-in-loop
  const idPromises = Array.from(
    { length: 10 },
    (_, i) =>
      new Promise<string>((resolve) =>
        setTimeout(
          () => resolve(generateCorrelationId(config, "iterator")),
          i * 2,
        )
      ),
  );

  const idsArray = await Promise.all(idPromises);
  const ids = new Set(idsArray);

  // All 10 IDs should be unique
  assertEquals(ids.size, 10);
});

Deno.test("generateCorrelationId - includes agent name", () => {
  const config = loadCoordinationConfig();

  const iteratorId = generateCorrelationId(config, "iterator");
  const reviewerId = generateCorrelationId(config, "reviewer");

  assertEquals(iteratorId.endsWith("-iterator"), true);
  assertEquals(reviewerId.endsWith("-reviewer"), true);
});

Deno.test("generateCorrelationId - starts with coord prefix", () => {
  const config = loadCoordinationConfig();
  const id = generateCorrelationId(config, "iterator");

  assertEquals(id.startsWith("coord-"), true);
});

// ============================================================================
// Integration tests - config loading with agent configs
// ============================================================================

Deno.test("loadCoordinationConfig - logging config is valid", () => {
  const config = loadCoordinationConfig();

  assertEquals(typeof config.logging.correlationIdFormat, "string");
  assertEquals(typeof config.logging.retainDays, "number");
  assertEquals(config.logging.retainDays, 30);
});

Deno.test("loadCoordinationConfig - issue template labels from handoff", () => {
  const config = loadCoordinationConfig();
  const labels = config.handoff.reviewerToIterator.issueTemplate.labels;

  assertEquals(Array.isArray(labels), true);
  assertEquals(labels.length, 2);
  assertEquals(labels[0], "implementation-gap");
  assertEquals(labels[1], "from-reviewer");
});

Deno.test("loadCoordinationConfig - iterator handoff config", () => {
  const config = loadCoordinationConfig();

  assertEquals(
    config.handoff.iteratorToReviewer.trigger,
    "internal-review-pass",
  );
  assertEquals(config.handoff.iteratorToReviewer.action, "add-review-label");
  assertEquals(
    config.handoff.iteratorToReviewer.commentTemplate.includes(
      "[Agent Handoff]",
    ),
    true,
  );
});

Deno.test("loadCoordinationConfig - reviewer complete config", () => {
  const config = loadCoordinationConfig();

  assertEquals(config.handoff.reviewerComplete.trigger, "no-gaps");
  assertEquals(config.handoff.reviewerComplete.action, "close-review-issue");
  assertEquals(
    config.handoff.reviewerComplete.commentTemplate.includes(
      "[Agent Review Complete]",
    ),
    true,
  );
});
