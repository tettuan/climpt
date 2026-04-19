/**
 * Deferred Items Emitter — convert agent structured output's `deferred_items[]`
 * into outbox `create-issue` actions, so that the existing OutboxProcessor
 * creates the follow-up issues before the current issue closes (T6 saga).
 *
 * The emitter is intentionally agent-agnostic: it inspects a single opaque
 * field (`deferred_items`) on the last structured output and does not care
 * which agent produced it. Schemas that want to participate must declare an
 * array of `{title, body, labels}` at the output root under this key.
 *
 * Ordering guarantee: files are written with a numeric `000-` prefix so the
 * OutboxProcessor picks them up before any externally-written actions
 * (which conventionally start at `001-`). The orchestrator closes the issue
 * via a direct saga call (T6), not via an outbox `close-issue`, so the
 * create-issue files always execute before the close.
 *
 * Project inheritance (issue #487, design §2.4 Hook O2):
 * When `parentProjects` are provided, each item without explicit `projects`
 * inherits the parent's project memberships. For each inherited project,
 * an `add-to-project` action is emitted immediately after the `create-issue`
 * action with `issueNumber` absent — the OutboxProcessor's late-binding
 * contract resolves this from the preceding `create-issue` result.
 *
 * Idempotency: each item is hashed (SHA-256 of canonical JSON) to produce
 * an idempotency key. Keys confirmed via `confirmEmitted()` are persisted
 * in the SubjectStore. On subsequent `emit()` calls (e.g. retry cycles),
 * items whose keys already exist are skipped, preventing duplicate issue
 * creation (see issue #484).
 */

import type { SubjectStore } from "./subject-store.ts";
import type { ProjectRef } from "./outbox-processor.ts";

/** A single deferred follow-up task extracted from agent output. */
export interface DeferredItem {
  readonly title: string;
  readonly body: string;
  readonly labels: readonly string[];
  /** Explicit project bindings. Absent = inherit parent. Empty array = opt-out. */
  readonly projects?: readonly ProjectRef[];
}

/** Successful emission: per-item file paths written to the outbox. */
export interface DeferredItemsEmitResult {
  readonly count: number;
  /**
   * Paths of `create-issue` action files only (1:1 with `emittedKeys`).
   * Supplementary `add-to-project` files are not included here as they
   * do not carry idempotency keys.
   */
  readonly paths: readonly string[];
  /** Idempotency keys for items that were actually emitted (new items only). */
  readonly emittedKeys: readonly string[];
}

/**
 * Compute a deterministic idempotency key for a deferred item.
 *
 * Uses SHA-256 of a canonical JSON representation where labels are sorted
 * to ensure order-independence. The full 64-char hex digest is returned
 * for collision resistance.
 */
export async function computeIdempotencyKey(
  item: DeferredItem,
): Promise<string> {
  const canonical = JSON.stringify({
    title: item.title,
    body: item.body,
    labels: [...item.labels].sort(),
  });
  const data = new TextEncoder().encode(canonical);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Normalize and validate the `deferred_items` field from an opaque structured
 * output. Returns `[]` on any of:
 *   - field absent / null / not an array
 *   - array is empty
 * Throws on:
 *   - array contains a non-object entry
 *   - entry is missing `title` (non-empty string), `body` (string), or
 *     `labels` (array of strings)
 *
 * Defensive: schema validation in the runner closure should already reject
 * malformed shapes, but the emitter must not silently drop items if the
 * runner's validation path changes.
 */
export function extractDeferredItems(
  structuredOutput: Record<string, unknown> | undefined,
): DeferredItem[] {
  if (!structuredOutput) return [];
  const raw = structuredOutput.deferred_items;
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new Error(
      `deferred_items must be an array, got ${typeof raw}`,
    );
  }
  const DEFERRED_ITEMS_CAP = 10;
  if (raw.length > DEFERRED_ITEMS_CAP) {
    throw new Error(
      `deferred_items has ${raw.length} items, exceeding the cap of ${DEFERRED_ITEMS_CAP}`,
    );
  }
  const items: DeferredItem[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(
        `deferred_items[${i}] must be an object, got ${typeof entry}`,
      );
    }
    const obj = entry as Record<string, unknown>;
    if (typeof obj.title !== "string" || obj.title.length === 0) {
      throw new Error(
        `deferred_items[${i}].title must be a non-empty string`,
      );
    }
    if (typeof obj.body !== "string") {
      throw new Error(`deferred_items[${i}].body must be a string`);
    }
    if (!Array.isArray(obj.labels)) {
      throw new Error(`deferred_items[${i}].labels must be an array`);
    }
    const labels: string[] = [];
    for (let j = 0; j < obj.labels.length; j++) {
      const label = obj.labels[j];
      if (typeof label !== "string") {
        throw new Error(
          `deferred_items[${i}].labels[${j}] must be a string`,
        );
      }
      labels.push(label);
    }
    // Parse optional projects field
    let projects: ProjectRef[] | undefined;
    if (obj.projects !== undefined) {
      if (!Array.isArray(obj.projects)) {
        throw new Error(`deferred_items[${i}].projects must be an array`);
      }
      projects = [];
      for (let j = 0; j < obj.projects.length; j++) {
        const p = obj.projects[j] as Record<string, unknown>;
        if (typeof p.id === "string") {
          projects.push({ id: p.id });
        } else if (
          typeof p.owner === "string" && typeof p.number === "number"
        ) {
          projects.push({ owner: p.owner, number: p.number });
        } else {
          throw new Error(
            `deferred_items[${i}].projects[${j}] must have {id} or {owner, number}`,
          );
        }
      }
    }
    items.push({ title: obj.title, body: obj.body, labels, projects });
  }
  return items;
}

/** Write `deferred_items[]` as outbox action files. */
export class DeferredItemsEmitter {
  #store: SubjectStore;

  constructor(store: SubjectStore) {
    this.#store = store;
  }

  /**
   * Emit deferred items for a subject. Returns `{count: 0, paths: [], emittedKeys: []}`
   * when the structured output has no deferred items or all items have already
   * been emitted in a previous cycle.
   *
   * Each item is written as a `create-issue` action followed by zero or more
   * `add-to-project` actions (for project inheritance). Files use sequential
   * numbering within the `000-deferred-` prefix to ensure correct sort order.
   *
   * Project inheritance (design §2.4 Hook O2):
   * When `parentProjects` are provided and an item has no explicit `projects`
   * field, an `add-to-project` action is emitted for each parent project
   * immediately after the `create-issue` action. Items with `projects: []`
   * (empty array) opt out of inheritance. Items with explicit `projects`
   * use their own list.
   *
   * Idempotency: items whose idempotency key (SHA-256 of canonical JSON)
   * already exists in the confirmed keys store are skipped. This prevents
   * duplicate issue creation on retry cycles (issue #484).
   *
   * @param parentProjects Projects the parent issue belongs to (for inheritance)
   */
  async emit(
    subjectId: string | number,
    structuredOutput: Record<string, unknown> | undefined,
    parentProjects?: readonly ProjectRef[],
  ): Promise<DeferredItemsEmitResult> {
    const items = extractDeferredItems(structuredOutput);
    if (items.length === 0) {
      return { count: 0, paths: [], emittedKeys: [] };
    }

    // Load previously confirmed keys and filter out already-emitted items.
    const existingKeys = await this.#store.readEmittedKeys(subjectId);
    const existingSet = new Set(existingKeys);

    const pending: { key: string; item: DeferredItem }[] = [];
    for (const item of items) {
      const key = await computeIdempotencyKey(item);
      if (!existingSet.has(key)) {
        pending.push({ key, item });
      }
    }

    if (pending.length === 0) {
      return { count: 0, paths: [], emittedKeys: [] };
    }

    const outboxDir = this.#store.getOutboxPath(subjectId);
    await Deno.mkdir(outboxDir, { recursive: true });

    const createIssuePaths: string[] = [];
    const allWrites: Promise<void>[] = [];
    let fileIndex = 0;

    for (const { item } of pending) {
      // Write create-issue action
      const createSeq = String(fileIndex).padStart(3, "0");
      const createPath = `${outboxDir}/000-deferred-${createSeq}.json`;
      const createPayload = {
        action: "create-issue",
        title: item.title,
        labels: [...item.labels],
        body: item.body,
      };
      allWrites.push(
        Deno.writeTextFile(
          createPath,
          JSON.stringify(createPayload, null, 2) + "\n",
        ),
      );
      createIssuePaths.push(createPath);
      fileIndex++;

      // Resolve projects for this item (inheritance logic)
      const projectsForItem = this.#resolveProjects(item, parentProjects);

      // Write add-to-project actions (one per project, late-bind issueNumber)
      for (const project of projectsForItem) {
        const bindSeq = String(fileIndex).padStart(3, "0");
        const bindPath = `${outboxDir}/000-deferred-${bindSeq}.json`;
        const bindPayload = {
          action: "add-to-project",
          project,
          // issueNumber absent — OutboxProcessor late-binds from
          // the preceding create-issue result (issue #487 Gap 1).
        };
        allWrites.push(
          Deno.writeTextFile(
            bindPath,
            JSON.stringify(bindPayload, null, 2) + "\n",
          ),
        );
        fileIndex++;
      }
    }

    await Promise.all(allWrites);

    return {
      count: pending.length,
      paths: createIssuePaths,
      emittedKeys: pending.map(({ key }) => key),
    };
  }

  /**
   * Confirm that emitted items were successfully created.
   *
   * Persists the given idempotency keys so that future `emit()` calls
   * skip these items. Must be called only after OutboxProcessor has
   * successfully processed all create-issue actions (all-success).
   *
   * Merges with any previously confirmed keys (union, deduplicated).
   */
  async confirmEmitted(
    subjectId: string | number,
    keys: readonly string[],
  ): Promise<void> {
    if (keys.length === 0) return;
    const existing = await this.#store.readEmittedKeys(subjectId);
    const merged = [...new Set([...existing, ...keys])];
    await this.#store.writeEmittedKeys(subjectId, merged);
  }

  /**
   * Determine which projects a deferred item should be added to.
   *
   * Design §2.4 Hook O2:
   * - `projects` absent + parentProjects provided → inherit all parent projects
   * - `projects: []` (empty array) → opt-out, no project binding
   * - `projects: [...]` (explicit list) → use that list
   * - No parentProjects → no binding
   */
  #resolveProjects(
    item: DeferredItem,
    parentProjects?: readonly ProjectRef[],
  ): readonly ProjectRef[] {
    if (item.projects !== undefined) {
      // Explicit projects field — use as-is (empty array = opt-out)
      return item.projects;
    }
    // Inherit from parent
    return parentProjects ?? [];
  }
}
