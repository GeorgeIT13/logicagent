import { describe, expect, it } from "vitest";
import { DataFlowValidator } from "./data-flow.js";

describe("DataFlowValidator", () => {
  describe("provider allowlist", () => {
    it("blocks non-allowed providers", () => {
      const validator = new DataFlowValidator({
        allowedProviders: ["openai", "anthropic"],
      });
      const result = validator.validate("hello", "google");
      expect(result.allowed).toBe(false);
      expect(result.violations.length).toBe(1);
      expect(result.violations[0]).toContain("not in the allowed");
    });

    it("allows listed providers (case-insensitive)", () => {
      const validator = new DataFlowValidator({
        allowedProviders: ["openai"],
      });
      const result = validator.validate("hello", "OpenAI");
      expect(result.allowed).toBe(true);
    });

    it("allows all providers when allowlist is empty", () => {
      const validator = new DataFlowValidator({});
      const result = validator.validate("hello", "any-provider");
      expect(result.allowed).toBe(true);
    });

    it("allows all providers when allowlist is undefined", () => {
      const validator = new DataFlowValidator();
      const result = validator.validate("hello", "random");
      expect(result.allowed).toBe(true);
    });
  });

  describe("sensitive data redaction", () => {
    it("redacts API keys in outbound data", () => {
      const validator = new DataFlowValidator();
      const text = "Use this key: AKIAIOSFODNN7EXAMPLE to access S3";
      const result = validator.validate(text, "openai");
      expect(result.allowed).toBe(true);
      expect(result.redacted).toContain("[REDACTED]");
      expect(result.redacted).not.toContain("AKIAIOSFODNN7EXAMPLE");
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.sensitiveMatches.length).toBeGreaterThan(0);
    });

    it("passes clean data through unchanged", () => {
      const validator = new DataFlowValidator();
      const text = "This is a normal prompt about coding.";
      const result = validator.validate(text, "openai");
      expect(result.allowed).toBe(true);
      expect(result.redacted).toBe(text);
      expect(result.violations).toEqual([]);
      expect(result.sensitiveMatches).toEqual([]);
    });

    it("applies custom redaction patterns", () => {
      const validator = new DataFlowValidator({
        redactionPatterns: ["INTERNAL_[A-Z0-9]+"],
      });
      const text = "The code is INTERNAL_ABC123 and needs review";
      const result = validator.validate(text, "openai");
      expect(result.redacted).toContain("[REDACTED]");
      expect(result.redacted).not.toContain("INTERNAL_ABC123");
    });
  });

  describe("isProviderAllowed", () => {
    it("returns true when no allowlist is set", () => {
      const validator = new DataFlowValidator();
      expect(validator.isProviderAllowed("anything")).toBe(true);
    });

    it("returns true for allowed providers", () => {
      const validator = new DataFlowValidator({
        allowedProviders: ["openai"],
      });
      expect(validator.isProviderAllowed("openai")).toBe(true);
      expect(validator.isProviderAllowed("OpenAI")).toBe(true);
    });

    it("returns false for non-allowed providers", () => {
      const validator = new DataFlowValidator({
        allowedProviders: ["openai"],
      });
      expect(validator.isProviderAllowed("anthropic")).toBe(false);
    });
  });
});
