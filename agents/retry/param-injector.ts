/**
 * Parameter Injector
 *
 * Injects parameters into templates.
 * Supports Handlebars-like syntax.
 */

/**
 * Injects parameters into a template
 *
 * Supported syntax:
 * - {{variable}} - Simple variable substitution
 * - {{#each array}}...{{/each}} - Array iteration
 * - {{#if condition}}...{{/if}} - Conditional blocks
 * - {{this}} - Current value in each loop
 * - {{this.property}} - Object property in each loop
 */
export function injectParams(
  template: string,
  params: Record<string, unknown>,
): string {
  let result = template;

  // 1. Process {{#each}} blocks
  result = processEachBlocks(result, params);

  // 2. Process {{#if}} blocks
  result = processIfBlocks(result, params);

  // 3. Process simple {{variable}} substitutions
  result = processSimpleSubstitutions(result, params);

  return result;
}

/**
 * Process {{#each array}}...{{/each}} blocks
 */
function processEachBlocks(
  template: string,
  params: Record<string, unknown>,
): string {
  const eachPattern = /\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g;

  return template.replace(eachPattern, (_match, arrayName, content) => {
    const array = params[arrayName];

    if (!Array.isArray(array)) {
      return "";
    }

    return array
      .map((item) => {
        let itemContent = content;

        // Process {{this}} for primitive values
        itemContent = itemContent.replace(
          /\{\{this\}\}/g,
          String(item),
        );

        // Process {{this.property}} for objects
        if (typeof item === "object" && item !== null) {
          const thisPropertyPattern = /\{\{this\.(\w+)\}\}/g;
          itemContent = itemContent.replace(
            thisPropertyPattern,
            (_: string, prop: string) => {
              const value = (item as Record<string, unknown>)[prop];
              return value !== undefined ? String(value) : "";
            },
          );
        }

        return itemContent;
      })
      .join("");
  });
}

/**
 * Process {{#if condition}}...{{/if}} blocks
 */
function processIfBlocks(
  template: string,
  params: Record<string, unknown>,
): string {
  // {{#if variable}}...{{else}}...{{/if}} pattern
  const ifElsePattern =
    /\{\{#if\s+(\w+(?:\.\w+)?)\}\}([\s\S]*?)\{\{else\}\}([\s\S]*?)\{\{\/if\}\}/g;
  let result = template.replace(
    ifElsePattern,
    (_match, conditionPath, ifContent, elseContent) => {
      const value = getNestedValue(params, conditionPath);
      return isTruthy(value) ? ifContent : elseContent;
    },
  );

  // {{#if variable}}...{{/if}} pattern (without else)
  const ifPattern = /\{\{#if\s+(\w+(?:\.\w+)?)\}\}([\s\S]*?)\{\{\/if\}\}/g;
  result = result.replace(ifPattern, (_match, conditionPath, content) => {
    const value = getNestedValue(params, conditionPath);
    return isTruthy(value) ? content : "";
  });

  return result;
}

/**
 * Process simple {{variable}} substitutions
 */
function processSimpleSubstitutions(
  template: string,
  params: Record<string, unknown>,
): string {
  const variablePattern = /\{\{(\w+(?:\.\w+)*)\}\}/g;

  return template.replace(variablePattern, (_match, path) => {
    const value = getNestedValue(params, path);
    if (value === undefined || value === null) {
      return "";
    }
    if (Array.isArray(value)) {
      return value.join(", ");
    }
    return String(value);
  });
}

/**
 * Get value from nested object
 */
function getNestedValue(
  obj: Record<string, unknown>,
  path: string,
): unknown {
  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Check if value is truthy
 */
function isTruthy(value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === 0) {
    return false;
  }
  if (typeof value === "string" && value === "") {
    return false;
  }
  if (Array.isArray(value) && value.length === 0) {
    return false;
  }
  return true;
}
