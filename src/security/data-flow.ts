/**
 * Data Flow Controls — validates and redacts data before it is sent to
 * external APIs (LLM providers, embedding services, tool endpoints).
 *
 * Enforces:
 * - Provider allowlist (only approved providers can receive data)
 * - Sensitive data redaction (credentials, tokens, PII stripped before transmission)
 * - Custom redaction patterns from config
 */

import {
  containsSensitiveData,
  redactSensitiveData,
  scanSensitiveData,
  type SensitiveMatch,
} from "./sensitive-data.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DataFlowConfig = {
  allowedProviders?: string[];
  redactionPatterns?: string[];
};

export type DataFlowValidationResult = {
  allowed: boolean;
  /** The data with sensitive content redacted (if any). */
  redacted: string;
  violations: string[];
  /** Sensitive matches found before redaction. */
  sensitiveMatches: SensitiveMatch[];
};

// ---------------------------------------------------------------------------
// DataFlowValidator
// ---------------------------------------------------------------------------

export class DataFlowValidator {
  private allowedProviders: Set<string> | null;
  private extraPatterns: string[];

  constructor(config?: DataFlowConfig) {
    this.allowedProviders =
      config?.allowedProviders && config.allowedProviders.length > 0
        ? new Set(config.allowedProviders.map((p) => p.toLowerCase()))
        : null; // null = all providers allowed
    this.extraPatterns = config?.redactionPatterns ?? [];
  }

  /**
   * Validate data before sending to an external provider.
   *
   * @param data - The text data to validate.
   * @param provider - Provider identifier (e.g. "openai", "anthropic", "google").
   * @returns Validation result with redacted data and any violations.
   */
  validate(data: string, provider: string): DataFlowValidationResult {
    const violations: string[] = [];

    // Provider allowlist check
    if (this.allowedProviders && !this.allowedProviders.has(provider.toLowerCase())) {
      violations.push(
        `Provider "${provider}" is not in the allowed providers list.`,
      );
      return {
        allowed: false,
        redacted: data,
        violations,
        sensitiveMatches: [],
      };
    }

    // Scan for sensitive data
    const sensitiveMatches = scanSensitiveData(data, this.extraPatterns);

    if (sensitiveMatches.length > 0) {
      const { redacted } = redactSensitiveData(data, this.extraPatterns);
      for (const match of sensitiveMatches) {
        violations.push(
          `Sensitive data detected (${match.type}) at offset ${match.offset} — redacted before transmission.`,
        );
      }
      return {
        allowed: true,
        redacted,
        violations,
        sensitiveMatches,
      };
    }

    return {
      allowed: true,
      redacted: data,
      violations: [],
      sensitiveMatches: [],
    };
  }

  /**
   * Quick check: is a provider allowed?
   */
  isProviderAllowed(provider: string): boolean {
    if (!this.allowedProviders) return true;
    return this.allowedProviders.has(provider.toLowerCase());
  }
}
