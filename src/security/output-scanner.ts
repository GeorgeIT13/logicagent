/**
 * Output Scanner — scans agent responses before delivery for data leakage,
 * system prompt echoing, and configurable policy violations.
 *
 * This is the last line of defense: even if a tool leaks data or the agent
 * is manipulated, the output scanner catches it before the user sees it.
 */

import {
  scanSensitiveData,
  type SensitiveMatch,
} from "./sensitive-data.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OutputScannerConfig = {
  enabled?: boolean;
  /** Fragments of the system prompt to detect if echoed in output. */
  systemPromptFragments?: string[];
  /** Additional sensitive data patterns (passed to SensitiveDataScanner). */
  sensitivePatterns?: string[];
};

export type ScanViolation = {
  type: "data_leakage" | "system_prompt_echo" | "policy_violation";
  severity: "warning" | "critical";
  description: string;
  /** Offset in the scanned text (if applicable). */
  offset?: number;
};

export type OutputScanResult = {
  clean: boolean;
  violations: ScanViolation[];
  sensitiveMatches: SensitiveMatch[];
};

// ---------------------------------------------------------------------------
// Default system prompt fragments to detect echoing
// ---------------------------------------------------------------------------

const DEFAULT_SYSTEM_PROMPT_MARKERS = [
  "you are an AI assistant",
  "you are a helpful assistant",
  "system prompt:",
  "your instructions are:",
  "INTERNAL INSTRUCTIONS",
  "SYSTEM:",
  "<<SYS>>",
  "[INST]",
];

// ---------------------------------------------------------------------------
// OutputScanner
// ---------------------------------------------------------------------------

export class OutputScanner {
  private enabled: boolean;
  private systemPromptFragments: string[];
  private sensitivePatterns: string[];

  constructor(config?: OutputScannerConfig) {
    this.enabled = config?.enabled !== false;
    this.systemPromptFragments = [
      ...DEFAULT_SYSTEM_PROMPT_MARKERS,
      ...(config?.systemPromptFragments ?? []),
    ];
    this.sensitivePatterns = config?.sensitivePatterns ?? [];
  }

  /**
   * Scan agent output text for violations.
   */
  scan(output: string): OutputScanResult {
    if (!this.enabled || !output) {
      return { clean: true, violations: [], sensitiveMatches: [] };
    }

    const violations: ScanViolation[] = [];

    // 1. Data leakage: check for sensitive data in output
    const sensitiveMatches = scanSensitiveData(output, this.sensitivePatterns);
    for (const match of sensitiveMatches) {
      violations.push({
        type: "data_leakage",
        severity: "critical",
        description: `Sensitive data (${match.type}) detected in agent output at offset ${match.offset}.`,
        offset: match.offset,
      });
    }

    // 2. System prompt echoing: check if output contains system prompt fragments
    const lowerOutput = output.toLowerCase();
    for (const fragment of this.systemPromptFragments) {
      const idx = lowerOutput.indexOf(fragment.toLowerCase());
      if (idx !== -1) {
        violations.push({
          type: "system_prompt_echo",
          severity: "warning",
          description: `Agent output may be echoing system prompt content: "${fragment}".`,
          offset: idx,
        });
      }
    }

    return {
      clean: violations.length === 0,
      violations,
      sensitiveMatches,
    };
  }
}
