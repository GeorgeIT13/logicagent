import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import {
  DEFAULT_COOLDOWN_DAYS,
  DEFAULT_MIN_APPROVALS,
  DEFAULT_MIN_APPROVAL_RATE,
  loadProgressionFile,
  markProposalSurfaced,
  recordApprovalOutcome,
  resetProgressionStats,
  resolveProgressionPath,
  shouldProposeUpgrade,
} from "./progression.js";

describe("AutonomyProgressionTracker", () => {
  const originalReadFileSync = fs.readFileSync;
  const originalWriteFileSync = fs.writeFileSync;
  const originalExistsSync = fs.existsSync;
  const originalMkdirSync = fs.mkdirSync;

  let store: Record<string, string>;

  beforeEach(() => {
    store = {};

    vi.spyOn(fs, "existsSync").mockImplementation((p) => {
      return typeof p === "string" && p in store;
    });

    vi.spyOn(fs, "readFileSync").mockImplementation((p, _enc) => {
      const key = typeof p === "string" ? p : p.toString();
      if (key in store) return store[key];
      throw new Error(`ENOENT: ${key}`);
    });

    vi.spyOn(fs, "writeFileSync").mockImplementation((p, data) => {
      store[typeof p === "string" ? p : p.toString()] =
        typeof data === "string" ? data : data.toString();
    });

    vi.spyOn(fs, "mkdirSync").mockImplementation(() => undefined as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("recordApprovalOutcome", () => {
    it("increments approval count on success", () => {
      recordApprovalOutcome(true, "test-agent");
      const file = loadProgressionFile();
      expect(file.agents["test-agent"].totalApprovals).toBe(1);
      expect(file.agents["test-agent"].consecutiveSuccesses).toBe(1);
    });

    it("increments denial count and resets streak on denial", () => {
      recordApprovalOutcome(true, "test-agent");
      recordApprovalOutcome(true, "test-agent");
      recordApprovalOutcome(false, "test-agent");
      const file = loadProgressionFile();
      expect(file.agents["test-agent"].totalApprovals).toBe(2);
      expect(file.agents["test-agent"].totalDenials).toBe(1);
      expect(file.agents["test-agent"].consecutiveSuccesses).toBe(0);
    });

    it("defaults agentId to main", () => {
      recordApprovalOutcome(true);
      const file = loadProgressionFile();
      expect(file.agents["main"].totalApprovals).toBe(1);
    });
  });

  describe("shouldProposeUpgrade", () => {
    function seedApprovals(count: number, agentId = "main") {
      for (let i = 0; i < count; i++) {
        recordApprovalOutcome(true, agentId);
      }
    }

    it("proposes upgrade when thresholds are met", () => {
      seedApprovals(DEFAULT_MIN_APPROVALS);
      const result = shouldProposeUpgrade("low");
      expect(result.propose).toBe(true);
      expect(result.fromLevel).toBe("low");
      expect(result.toLevel).toBe("medium");
    });

    it("does not propose when already at high", () => {
      seedApprovals(DEFAULT_MIN_APPROVALS);
      const result = shouldProposeUpgrade("high");
      expect(result.propose).toBe(false);
      expect(result.reason).toContain("maximum");
    });

    it("does not propose with insufficient approvals", () => {
      seedApprovals(10);
      const result = shouldProposeUpgrade("low");
      expect(result.propose).toBe(false);
      expect(result.reason).toContain("Need at least");
    });

    it("does not propose when approval rate is too low", () => {
      seedApprovals(48);
      recordApprovalOutcome(false);
      recordApprovalOutcome(false);
      recordApprovalOutcome(false);
      const result = shouldProposeUpgrade("low");
      expect(result.propose).toBe(false);
      expect(result.reason).toContain("below threshold");
    });

    it("respects cooldown after a proposal", () => {
      seedApprovals(DEFAULT_MIN_APPROVALS);
      markProposalSurfaced();
      const result = shouldProposeUpgrade("low");
      expect(result.propose).toBe(false);
      expect(result.reason).toContain("Cooldown");
    });

    it("respects disabled config", () => {
      seedApprovals(DEFAULT_MIN_APPROVALS);
      const result = shouldProposeUpgrade("low", { enabled: false });
      expect(result.propose).toBe(false);
      expect(result.reason).toContain("disabled");
    });

    it("uses custom thresholds", () => {
      seedApprovals(10);
      const result = shouldProposeUpgrade("low", {
        minApprovals: 5,
        minApprovalRate: 0.8,
      });
      expect(result.propose).toBe(true);
    });

    it("proposes medium → high", () => {
      seedApprovals(DEFAULT_MIN_APPROVALS);
      const result = shouldProposeUpgrade("medium");
      expect(result.propose).toBe(true);
      expect(result.toLevel).toBe("high");
    });
  });

  describe("resetProgressionStats", () => {
    it("clears stats for an agent", () => {
      recordApprovalOutcome(true, "test-agent");
      resetProgressionStats("test-agent");
      const file = loadProgressionFile();
      expect(file.agents["test-agent"]).toBeUndefined();
    });
  });
});
