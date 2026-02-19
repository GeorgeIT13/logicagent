/**
 * Sensitive Data Scanner — pattern-based detection of credentials, tokens,
 * private keys, and PII in arbitrary text.
 *
 * Used by:
 * - Data flow controls (redact before external API calls)
 * - Output scanner (detect leakage in agent responses)
 * - Memory writes (prevent storing secrets)
 */

export type SensitiveMatchType =
  | "aws_access_key"
  | "aws_secret_key"
  | "openai_api_key"
  | "anthropic_api_key"
  | "generic_api_key"
  | "private_key_pem"
  | "jwt"
  | "github_token"
  | "slack_token"
  | "generic_secret"
  | "credit_card"
  | "ssn"
  | "custom";

export type SensitiveMatch = {
  type: SensitiveMatchType;
  /** Character offset in the scanned text. */
  offset: number;
  /** Length of the matched text. */
  length: number;
  /** The matched text (first 8 chars + "…" for safety). */
  preview: string;
};

type PatternEntry = {
  type: SensitiveMatchType;
  pattern: RegExp;
};

const BUILTIN_PATTERNS: PatternEntry[] = [
  { type: "aws_access_key", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  {
    type: "aws_secret_key",
    pattern: /\b[A-Za-z0-9/+=]{40}\b(?=.*(?:aws|secret|key))/gi,
  },
  // Anthropic before OpenAI — sk-ant- is a more specific prefix than sk-
  { type: "anthropic_api_key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { type: "openai_api_key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  {
    type: "github_token",
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}\b/g,
  },
  {
    type: "slack_token",
    pattern: /\bxox[bpars]-[A-Za-z0-9-]{10,}\b/g,
  },
  {
    type: "private_key_pem",
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
  },
  {
    type: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  },
  {
    type: "generic_api_key",
    pattern:
      /\b(?:api[_-]?key|apikey|api[_-]?secret|access[_-]?token|auth[_-]?token|bearer)\s*[:=]\s*["']?([A-Za-z0-9_\-/.+=]{16,})["']?/gi,
  },
  {
    type: "generic_secret",
    pattern:
      /\b(?:password|passwd|secret|token|credential)\s*[:=]\s*["']?([^\s"']{8,})["']?/gi,
  },
  {
    type: "credit_card",
    pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g,
  },
  { type: "ssn", pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
];

function safePreview(text: string, offset: number, length: number): string {
  const raw = text.slice(offset, offset + length);
  if (raw.length <= 8) return raw;
  return `${raw.slice(0, 8)}…`;
}

/**
 * Scan text for sensitive data patterns.
 *
 * @param text - The text to scan.
 * @param extraPatterns - Additional regex patterns (strings compiled to RegExp).
 * @returns Array of matches with type, offset, length, and safe preview.
 */
export function scanSensitiveData(
  text: string,
  extraPatterns?: string[],
): SensitiveMatch[] {
  if (!text) return [];

  const matches: SensitiveMatch[] = [];
  const allPatterns: PatternEntry[] = [...BUILTIN_PATTERNS];

  if (extraPatterns) {
    for (const p of extraPatterns) {
      try {
        allPatterns.push({ type: "custom", pattern: new RegExp(p, "g") });
      } catch {
        // skip invalid patterns
      }
    }
  }

  for (const entry of allPatterns) {
    entry.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = entry.pattern.exec(text)) !== null) {
      matches.push({
        type: entry.type,
        offset: match.index,
        length: match[0].length,
        preview: safePreview(text, match.index, match[0].length),
      });
    }
  }

  // Deduplicate overlapping matches (keep the first/longest)
  matches.sort((a, b) => a.offset - b.offset || b.length - a.length);
  const deduped: SensitiveMatch[] = [];
  let lastEnd = -1;
  for (const m of matches) {
    if (m.offset >= lastEnd) {
      deduped.push(m);
      lastEnd = m.offset + m.length;
    }
  }

  return deduped;
}

/**
 * Redact sensitive data in text, replacing matches with `[REDACTED]`.
 */
export function redactSensitiveData(
  text: string,
  extraPatterns?: string[],
): { redacted: string; matchCount: number } {
  const matches = scanSensitiveData(text, extraPatterns);
  if (matches.length === 0) return { redacted: text, matchCount: 0 };

  let result = "";
  let cursor = 0;
  for (const m of matches) {
    result += text.slice(cursor, m.offset);
    result += "[REDACTED]";
    cursor = m.offset + m.length;
  }
  result += text.slice(cursor);

  return { redacted: result, matchCount: matches.length };
}

/**
 * Quick check: does the text contain any sensitive data?
 */
export function containsSensitiveData(
  text: string,
  extraPatterns?: string[],
): boolean {
  return scanSensitiveData(text, extraPatterns).length > 0;
}
