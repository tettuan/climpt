/**
 * Action detector - finds structured actions in LLM output
 */

import type { ActionConfig, DetectedAction } from "./types.ts";

export class ActionDetector {
  private outputFormat: string;
  private allowedTypes: Set<string>;
  private enabled: boolean;

  constructor(config: ActionConfig) {
    this.enabled = config.enabled;
    this.outputFormat = config.outputFormat;
    this.allowedTypes = new Set(config.types);
  }

  /**
   * Detect actions in content
   * Actions are formatted as JSON within markdown code blocks:
   * ```{outputFormat}
   * { "type": "...", "content": "...", ... }
   * ```
   */
  detect(content: string): DetectedAction[] {
    if (!this.enabled) {
      return [];
    }

    const actions: DetectedAction[] = [];

    // Match: ```{outputFormat}\n{json}\n```
    const regex = new RegExp(
      `\`\`\`${this.escapeRegex(this.outputFormat)}\\n([\\s\\S]*?)\\n\`\`\``,
      "g",
    );

    let match;
    while ((match = regex.exec(content)) !== null) {
      const raw = match[1].trim();

      try {
        const parsed = JSON.parse(raw);

        // Validate type
        if (!parsed.type || !this.allowedTypes.has(parsed.type)) {
          continue;
        }

        actions.push({
          type: parsed.type,
          content: parsed.content ?? "",
          metadata: this.extractMetadata(parsed),
          raw,
        });
      } catch {
        // Skip invalid JSON
      }
    }

    return actions;
  }

  /**
   * Extract metadata (all fields except type and content)
   */
  private extractMetadata(
    parsed: Record<string, unknown>,
  ): Record<string, unknown> {
    const { type: _type, content: _content, ...metadata } = parsed;
    return metadata;
  }

  /**
   * Escape special regex characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * Check if detection is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get allowed action types
   */
  getAllowedTypes(): string[] {
    return Array.from(this.allowedTypes);
  }

  /**
   * Check if a type is allowed
   */
  isTypeAllowed(type: string): boolean {
    return this.allowedTypes.has(type);
  }
}
