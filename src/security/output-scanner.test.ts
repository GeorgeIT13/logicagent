import { describe, expect, it } from "vitest";
import { OutputScanner } from "./output-scanner.js";

describe("OutputScanner", () => {
  describe("data leakage detection", () => {
    it("detects API keys in output", () => {
      const scanner = new OutputScanner();
      const result = scanner.scan(
        "Here's your AWS key: AKIAIOSFODNN7EXAMPLE",
      );
      expect(result.clean).toBe(false);
      expect(result.violations.some((v) => v.type === "data_leakage")).toBe(true);
      expect(result.sensitiveMatches.length).toBeGreaterThan(0);
    });

    it("detects private key PEM in output", () => {
      const scanner = new OutputScanner();
      const result = scanner.scan(
        "The key content is:\n-----BEGIN RSA PRIVATE KEY-----\nMIIEpAI...",
      );
      expect(result.clean).toBe(false);
      expect(result.violations.some((v) => v.type === "data_leakage")).toBe(true);
    });

    it("passes clean output", () => {
      const scanner = new OutputScanner();
      const result = scanner.scan(
        "Here is the analysis of your code: the function returns a string.",
      );
      expect(result.clean).toBe(true);
      expect(result.violations).toEqual([]);
    });
  });

  describe("system prompt echoing", () => {
    it("detects default system prompt markers", () => {
      const scanner = new OutputScanner();
      const result = scanner.scan(
        "As stated in the INTERNAL INSTRUCTIONS, I should not reveal...",
      );
      expect(result.clean).toBe(false);
      expect(result.violations.some((v) => v.type === "system_prompt_echo")).toBe(true);
    });

    it("detects custom system prompt fragments", () => {
      const scanner = new OutputScanner({
        systemPromptFragments: ["Logic Agent security boundary"],
      });
      const result = scanner.scan(
        "The Logic Agent security boundary states that I cannot...",
      );
      expect(result.clean).toBe(false);
      expect(result.violations.some((v) => v.type === "system_prompt_echo")).toBe(true);
    });

    it("is case-insensitive for fragment matching", () => {
      const scanner = new OutputScanner();
      const result = scanner.scan("my internal instructions say...");
      expect(result.violations.some((v) => v.type === "system_prompt_echo")).toBe(true);
    });
  });

  describe("configuration", () => {
    it("can be disabled", () => {
      const scanner = new OutputScanner({ enabled: false });
      const result = scanner.scan("AKIAIOSFODNN7EXAMPLE");
      expect(result.clean).toBe(true);
      expect(result.violations).toEqual([]);
    });

    it("handles empty output", () => {
      const scanner = new OutputScanner();
      const result = scanner.scan("");
      expect(result.clean).toBe(true);
    });

    it("supports custom sensitive patterns", () => {
      const scanner = new OutputScanner({
        sensitivePatterns: ["COMPANY_SECRET_[A-Z0-9]+"],
      });
      const result = scanner.scan("The value is COMPANY_SECRET_XYZ789");
      expect(result.clean).toBe(false);
      expect(result.violations.some((v) => v.type === "data_leakage")).toBe(true);
    });
  });

  describe("combined violations", () => {
    it("reports both data leakage and prompt echoing", () => {
      const scanner = new OutputScanner();
      const result = scanner.scan(
        "As stated in my INTERNAL INSTRUCTIONS: use key AKIAIOSFODNN7EXAMPLE",
      );
      expect(result.clean).toBe(false);
      const types = result.violations.map((v) => v.type);
      expect(types).toContain("data_leakage");
      expect(types).toContain("system_prompt_echo");
    });
  });
});
