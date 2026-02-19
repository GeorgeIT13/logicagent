import { describe, expect, it } from "vitest";
import {
  containsSensitiveData,
  redactSensitiveData,
  scanSensitiveData,
} from "./sensitive-data.js";

describe("scanSensitiveData", () => {
  it("detects AWS access keys", () => {
    const text = "my key is AKIAIOSFODNN7EXAMPLE ok";
    const matches = scanSensitiveData(text);
    expect(matches.length).toBe(1);
    expect(matches[0].type).toBe("aws_access_key");
  });

  it("detects OpenAI API keys", () => {
    const text = "key: sk-abc123def456ghi789jkl012mno";
    const matches = scanSensitiveData(text);
    expect(matches.some((m) => m.type === "openai_api_key")).toBe(true);
  });

  it("detects Anthropic API keys", () => {
    const text = "use sk-ant-abc123def456ghi789jkl012mno for calls";
    const matches = scanSensitiveData(text);
    expect(matches.some((m) => m.type === "anthropic_api_key")).toBe(true);
  });

  it("detects GitHub tokens", () => {
    const text = "use ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij for auth";
    const matches = scanSensitiveData(text);
    expect(matches.some((m) => m.type === "github_token")).toBe(true);
  });

  it("detects Slack tokens", () => {
    const text = "use xoxb-1234567890-abcdefghij for chat";
    const matches = scanSensitiveData(text);
    expect(matches.some((m) => m.type === "slack_token")).toBe(true);
  });

  it("detects private key PEM headers", () => {
    const text = "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBA...";
    const matches = scanSensitiveData(text);
    expect(matches.some((m) => m.type === "private_key_pem")).toBe(true);
  });

  it("detects JWTs", () => {
    const text =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const matches = scanSensitiveData(text);
    expect(matches.some((m) => m.type === "jwt")).toBe(true);
  });

  it("detects generic secrets (password=...)", () => {
    const text = 'password="mysuperSecretP4ssw0rd!"';
    const matches = scanSensitiveData(text);
    expect(matches.some((m) => m.type === "generic_secret")).toBe(true);
  });

  it("detects credit card numbers", () => {
    const text = "card: 4111111111111111";
    const matches = scanSensitiveData(text);
    expect(matches.some((m) => m.type === "credit_card")).toBe(true);
  });

  it("detects SSNs", () => {
    const text = "ssn: 123-45-6789";
    const matches = scanSensitiveData(text);
    expect(matches.some((m) => m.type === "ssn")).toBe(true);
  });

  it("returns empty array for clean text", () => {
    const text = "This is a perfectly normal piece of text without secrets.";
    expect(scanSensitiveData(text)).toEqual([]);
  });

  it("returns empty array for empty input", () => {
    expect(scanSensitiveData("")).toEqual([]);
  });

  it("supports custom extra patterns", () => {
    const text = "internal ref MYPREFIX_12345678 is classified";
    const matches = scanSensitiveData(text, ["MYPREFIX_[0-9]+"]);
    expect(matches.some((m) => m.type === "custom")).toBe(true);
  });

  it("ignores invalid extra patterns", () => {
    const text = "some text";
    // invalid regex (unmatched bracket) should be skipped silently
    expect(() => scanSensitiveData(text, ["[invalid"])).not.toThrow();
  });

  it("truncates preview to 8 chars", () => {
    const text = "AKIAIOSFODNN7EXAMPLE";
    const matches = scanSensitiveData(text);
    expect(matches[0].preview.length).toBeLessThanOrEqual(9); // 8 + "…"
  });

  it("deduplicates overlapping matches", () => {
    // A string that could match multiple patterns at overlapping offsets
    const text = "sk-ant-abc123def456ghi789jkl012mno";
    const matches = scanSensitiveData(text);
    // All matches should be non-overlapping
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i].offset).toBeGreaterThanOrEqual(
        matches[i - 1].offset + matches[i - 1].length,
      );
    }
  });
});

describe("redactSensitiveData", () => {
  it("replaces sensitive data with [REDACTED]", () => {
    const text = "my key is AKIAIOSFODNN7EXAMPLE ok";
    const { redacted, matchCount } = redactSensitiveData(text);
    expect(matchCount).toBe(1);
    expect(redacted).toContain("[REDACTED]");
    expect(redacted).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("returns original text when nothing found", () => {
    const text = "clean text";
    const { redacted, matchCount } = redactSensitiveData(text);
    expect(matchCount).toBe(0);
    expect(redacted).toBe(text);
  });

  it("handles multiple matches", () => {
    const text = "key1: AKIAIOSFODNN7EXAMPLE key2: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";
    const { redacted, matchCount } = redactSensitiveData(text);
    expect(matchCount).toBe(2);
    expect(redacted.match(/\[REDACTED\]/g)?.length).toBe(2);
  });
});

describe("containsSensitiveData", () => {
  it("returns true when sensitive data is present", () => {
    expect(containsSensitiveData("AKIAIOSFODNN7EXAMPLE")).toBe(true);
  });

  it("returns false for clean text", () => {
    expect(containsSensitiveData("nothing sensitive here")).toBe(false);
  });
});
