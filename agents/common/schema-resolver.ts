/**
 * JSON Schema $ref Resolver
 *
 * Resolves external and internal $ref pointers in JSON Schemas,
 * producing a fully dereferenced schema suitable for Claude SDK's
 * structured output feature.
 *
 * Key Features:
 * - Resolves external file references (e.g., "common.schema.json#/$defs/foo")
 * - Resolves internal references (e.g., "#/$defs/bar")
 * - Handles nested and recursive references
 * - Adds additionalProperties: false to all object types (SDK requirement)
 * - Caches loaded files to avoid redundant I/O
 *
 * @module
 */

import { dirname, join } from "@std/path";

/**
 * Error thrown when a JSON Pointer path cannot be resolved in a schema.
 * This is a fatal error that should halt the Flow loop.
 */
export class SchemaPointerError extends Error {
  readonly pointer: string;
  readonly file: string;

  constructor(pointer: string, file: string) {
    super(
      `No schema pointer "${pointer}" found in ${file}. ` +
        `Ensure the pointer uses JSON Pointer format (e.g., "#/definitions/stepId") ` +
        `and that the referenced definition exists in the schema file.`,
    );
    this.name = "SchemaPointerError";
    this.pointer = pointer;
    this.file = file;
  }
}

/**
 * Schema resolver with file caching
 */
export class SchemaResolver {
  /** Cache of loaded schema files */
  private fileCache: Map<string, Record<string, unknown>> = new Map();

  /** Base directory for schema files */
  private baseDir: string;

  /** Maximum recursion depth to prevent infinite loops */
  private static readonly MAX_DEPTH = 50;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  /**
   * Resolve all $ref pointers in a schema and prepare it for SDK use.
   *
   * @param schemaFile - Schema file name (e.g., "issue.schema.json")
   * @param schemaName - Top-level schema key (e.g., "initial.issue")
   * @returns Fully resolved schema with additionalProperties: false
   */
  async resolve(
    schemaFile: string,
    schemaName: string,
  ): Promise<Record<string, unknown>> {
    const filePath = join(this.baseDir, schemaFile);
    const schemas = await this.loadFile(filePath);
    const schema = schemas[schemaName];

    if (!schema || typeof schema !== "object") {
      throw new Error(`Schema "${schemaName}" not found in ${schemaFile}`);
    }

    // Deep clone to avoid mutating cached data
    const cloned = structuredClone(schema) as Record<string, unknown>;

    // Resolve all $refs and add additionalProperties: false
    const resolved = await this.resolveRefs(cloned, filePath, new Set(), 0);

    return resolved;
  }

  /**
   * Load a schema file with caching
   */
  private async loadFile(
    filePath: string,
  ): Promise<Record<string, unknown>> {
    const cached = this.fileCache.get(filePath);
    if (cached !== undefined) {
      return cached;
    }

    const content = await Deno.readTextFile(filePath);
    const parsed = JSON.parse(content) as Record<string, unknown>;
    this.fileCache.set(filePath, parsed);
    return parsed;
  }

  /**
   * Recursively resolve all $ref pointers in an object
   */
  private async resolveRefs(
    obj: unknown,
    currentFile: string,
    visited: Set<string>,
    depth: number,
  ): Promise<Record<string, unknown>> {
    if (depth > SchemaResolver.MAX_DEPTH) {
      throw new Error(`Maximum recursion depth exceeded resolving $refs`);
    }

    if (obj === null || typeof obj !== "object") {
      return obj as Record<string, unknown>;
    }

    if (Array.isArray(obj)) {
      const resolved = await Promise.all(
        obj.map((item) => this.resolveRefs(item, currentFile, visited, depth)),
      );
      return resolved as unknown as Record<string, unknown>;
    }

    const record = obj as Record<string, unknown>;

    // Handle $ref
    if (typeof record.$ref === "string") {
      return await this.resolveRef(
        record.$ref,
        currentFile,
        visited,
        depth + 1,
      );
    }

    // Handle allOf - merge all schemas
    if (Array.isArray(record.allOf)) {
      const merged = await this.mergeAllOf(
        record.allOf as Record<string, unknown>[],
        record,
        currentFile,
        visited,
        depth + 1,
      );
      return this.ensureAdditionalPropertiesFalse(merged);
    }

    // Recursively resolve nested objects using Promise.all
    const entries = Object.entries(record);
    const resolvedValues = await Promise.all(
      entries.map(([_key, value]) =>
        this.resolveRefs(value, currentFile, visited, depth)
      ),
    );

    const resolved: Record<string, unknown> = {};
    for (let i = 0; i < entries.length; i++) {
      resolved[entries[i][0]] = resolvedValues[i];
    }

    // Add additionalProperties: false to object types
    return this.ensureAdditionalPropertiesFalse(resolved);
  }

  /**
   * Resolve a single $ref pointer
   */
  private async resolveRef(
    ref: string,
    currentFile: string,
    visited: Set<string>,
    depth: number,
  ): Promise<Record<string, unknown>> {
    // Create unique key for cycle detection
    const refKey = `${currentFile}::${ref}`;
    if (visited.has(refKey)) {
      // Circular reference - return empty object to break cycle
      return {};
    }
    visited.add(refKey);

    // Parse the reference
    const [filePart, fragmentPart] = ref.split("#");
    let targetFile = currentFile;
    const targetPath = fragmentPart || "";

    // External reference
    if (filePart) {
      targetFile = join(dirname(currentFile), filePart);
    }

    // Load the target file
    const schemas = await this.loadFile(targetFile);

    // Navigate to the referenced definition (throws SchemaPointerError on failure)
    const resolved = this.navigateToPath(schemas, targetPath, targetFile);

    // Recursively resolve any nested $refs
    const cloned = structuredClone(resolved) as Record<string, unknown>;
    return await this.resolveRefs(cloned, targetFile, new Set(visited), depth);
  }

  /**
   * Navigate to a JSON pointer path (e.g., "/$defs/stepResponse")
   *
   * @throws SchemaPointerError if the path cannot be resolved
   */
  private navigateToPath(
    obj: Record<string, unknown>,
    path: string,
    filePath: string,
  ): unknown {
    if (!path || path === "/") {
      return obj;
    }

    // Normalize pointer: ensure proper format for #/definitions/... style
    const normalizedPath = this.normalizePointer(path);

    // Remove leading slash and split
    const parts = normalizedPath.startsWith("/")
      ? normalizedPath.slice(1).split("/")
      : normalizedPath.split("/");

    let current: unknown = obj;
    for (const part of parts) {
      if (current === null || typeof current !== "object") {
        throw new SchemaPointerError(path, filePath);
      }
      const next = (current as Record<string, unknown>)[part];
      if (next === undefined) {
        throw new SchemaPointerError(path, filePath);
      }
      current = next;
    }

    return current;
  }

  /**
   * Normalize JSON Pointer to standard format.
   * Handles both "#/definitions/foo" and "/definitions/foo" formats.
   */
  private normalizePointer(pointer: string): string {
    // Remove leading # if present (fragment identifier)
    if (pointer.startsWith("#")) {
      return pointer.slice(1);
    }
    return pointer;
  }

  /**
   * Merge allOf schemas into a single schema
   */
  private async mergeAllOf(
    allOf: Record<string, unknown>[],
    parent: Record<string, unknown>,
    currentFile: string,
    visited: Set<string>,
    depth: number,
  ): Promise<Record<string, unknown>> {
    // Start with parent properties (excluding allOf)
    const result: Record<string, unknown> = {};

    // Copy parent properties except allOf using Promise.all
    const parentEntries = Object.entries(parent).filter(([key]) =>
      key !== "allOf"
    );
    const parentResolvedValues = await Promise.all(
      parentEntries.map(([_key, value]) =>
        this.resolveRefs(value, currentFile, visited, depth)
      ),
    );
    for (let i = 0; i < parentEntries.length; i++) {
      result[parentEntries[i][0]] = parentResolvedValues[i];
    }

    // Merge each schema in allOf using Promise.all
    const allOfResolved = await Promise.all(
      allOf.map((schema) =>
        this.resolveRefs(schema, currentFile, visited, depth)
      ),
    );
    for (const resolved of allOfResolved) {
      this.deepMerge(result, resolved);
    }

    return result;
  }

  /**
   * Deep merge source into target
   */
  private deepMerge(
    target: Record<string, unknown>,
    source: Record<string, unknown>,
  ): void {
    for (const [key, value] of Object.entries(source)) {
      if (key === "required") {
        // Merge required arrays
        const existing = target[key] as string[] | undefined;
        const incoming = value as string[];
        target[key] = [...new Set([...(existing ?? []), ...incoming])];
      } else if (key === "properties" && typeof value === "object") {
        // Merge properties
        const existing = (target[key] ?? {}) as Record<string, unknown>;
        target[key] = { ...existing, ...value };
      } else if (!(key in target)) {
        target[key] = value;
      }
    }
  }

  /**
   * Ensure additionalProperties: false is set on object types
   */
  private ensureAdditionalPropertiesFalse(
    schema: Record<string, unknown>,
  ): Record<string, unknown> {
    // Only add to object types with properties defined
    if (
      schema.type === "object" ||
      schema.properties !== undefined
    ) {
      // Don't override if explicitly set
      if (!("additionalProperties" in schema)) {
        schema.additionalProperties = false;
      }
    }

    return schema;
  }

  /**
   * Clear the file cache
   */
  clearCache(): void {
    this.fileCache.clear();
  }
}

/**
 * Convenience function to resolve a schema
 *
 * @param baseDir - Base directory for schema files
 * @param schemaFile - Schema file name
 * @param schemaName - Top-level schema key
 * @returns Fully resolved schema
 */
export function resolveSchema(
  baseDir: string,
  schemaFile: string,
  schemaName: string,
): Promise<Record<string, unknown>> {
  const resolver = new SchemaResolver(baseDir);
  return resolver.resolve(schemaFile, schemaName);
}
