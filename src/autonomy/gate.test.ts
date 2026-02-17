import { describe, expect, it } from "vitest";
import { classifyAction, registerToolTier, unregisterToolTier } from "./classifier.js";
import { evaluateGate, isValidAutonomyLevel, parseAutonomyLevel } from "./gate.js";
import type { ActionTier, AutonomyLevel } from "./types.js";

// ---------------------------------------------------------------------------
// Classifier tests
// ---------------------------------------------------------------------------

describe("classifyAction", () => {
  it("classifies read-only tools as cached_pattern", () => {
    for (const tool of ["read", "grep", "find", "ls", "web_search", "web_fetch", "memory_search", "memory_get"]) {
      expect(classifyAction(tool)).toBe("cached_pattern");
    }
  });

  it("classifies write tools as ephemeral_compute", () => {
    for (const tool of ["write", "edit", "apply_patch", "exec", "bash", "process"]) {
      expect(classifyAction(tool)).toBe("ephemeral_compute");
    }
  });

  it("classifies infrastructure tools as persistent_service", () => {
    for (const tool of ["cron", "gateway", "nodes", "subagents", "sessions_spawn"]) {
      expect(classifyAction(tool)).toBe("persistent_service");
    }
  });

  it("classifies sandbox tools as sandboxed_workspace", () => {
    for (const tool of ["browser", "canvas"]) {
      expect(classifyAction(tool)).toBe("sandboxed_workspace");
    }
  });

  it("classifies messaging tools as irreversible", () => {
    for (const tool of ["message", "sessions_send", "whatsapp_login"]) {
      expect(classifyAction(tool)).toBe("irreversible");
    }
  });

  it("defaults unknown tools to persistent_service (conservative)", () => {
    expect(classifyAction("unknown_fancy_tool")).toBe("persistent_service");
  });

  it("respects ToolAutonomyHint over static map", () => {
    expect(classifyAction("read", {}, { tier: "irreversible" })).toBe("irreversible");
  });

  it("respects runtime overrides over static map", () => {
    registerToolTier("read", "irreversible");
    expect(classifyAction("read")).toBe("irreversible");
    unregisterToolTier("read");
    expect(classifyAction("read")).toBe("cached_pattern");
  });

  it("hint takes priority over runtime override", () => {
    registerToolTier("read", "persistent_service");
    expect(classifyAction("read", {}, { tier: "ephemeral_compute" })).toBe("ephemeral_compute");
    unregisterToolTier("read");
  });
});

// ---------------------------------------------------------------------------
// Gate evaluation tests — full policy matrix
// ---------------------------------------------------------------------------

describe("evaluateGate", () => {
  const levels: AutonomyLevel[] = ["low", "medium", "high"];
  const tiers: ActionTier[] = [
    "cached_pattern",
    "ephemeral_compute",
    "persistent_service",
    "sandboxed_workspace",
    "irreversible",
  ];

  // Exhaustive expected matrix: [level][tier] → decision
  const expectedMatrix: Record<AutonomyLevel, Record<ActionTier, string>> = {
    low: {
      cached_pattern: "auto_approve",
      ephemeral_compute: "needs_approval",
      persistent_service: "needs_approval",
      sandboxed_workspace: "needs_approval",
      irreversible: "needs_approval",
    },
    medium: {
      cached_pattern: "auto_approve",
      ephemeral_compute: "auto_approve",
      persistent_service: "needs_approval",
      sandboxed_workspace: "needs_approval",
      irreversible: "needs_approval",
    },
    high: {
      cached_pattern: "auto_approve",
      ephemeral_compute: "auto_approve",
      persistent_service: "auto_approve",
      sandboxed_workspace: "auto_approve",
      irreversible: "needs_approval",
    },
  };

  for (const level of levels) {
    for (const tier of tiers) {
      const expected = expectedMatrix[level][tier];
      it(`${level} + ${tier} → ${expected}`, () => {
        const result = evaluateGate(level, tier);
        expect(result.decision).toBe(expected);
        expect(result.level).toBe(level);
        expect(result.tier).toBe(tier);
        expect(result.reason).toBeTruthy();
      });
    }
  }

  // Irreversible always needs approval regardless of level
  it("irreversible always needs approval even at high autonomy", () => {
    const result = evaluateGate("high", "irreversible");
    expect(result.decision).toBe("needs_approval");
  });

  // Cached pattern always auto-approves regardless of level
  it("cached_pattern always auto-approves even at low autonomy", () => {
    const result = evaluateGate("low", "cached_pattern");
    expect(result.decision).toBe("auto_approve");
  });
});

// ---------------------------------------------------------------------------
// Confidence threshold tests
// ---------------------------------------------------------------------------

describe("evaluateGate confidence", () => {
  it("downgrades auto_approve to needs_approval when confidence is low", () => {
    // high + persistent_service is normally auto_approve
    const result = evaluateGate("high", "persistent_service", 0.5);
    expect(result.decision).toBe("needs_approval");
    expect(result.confidence).toBe(0.5);
    expect(result.reason).toContain("confidence");
  });

  it("keeps auto_approve when confidence is above threshold", () => {
    const result = evaluateGate("high", "persistent_service", 0.9);
    expect(result.decision).toBe("auto_approve");
  });

  it("does not affect needs_approval decisions regardless of confidence", () => {
    // low + ephemeral_compute is needs_approval — confidence shouldn't change it
    const result = evaluateGate("low", "ephemeral_compute", 0.3);
    expect(result.decision).toBe("needs_approval");
  });

  it("treats undefined confidence as high confidence", () => {
    const result = evaluateGate("high", "ephemeral_compute");
    expect(result.decision).toBe("auto_approve");
    expect(result.confidence).toBeUndefined();
  });

  it("boundary: exactly at threshold (0.7) stays auto_approve", () => {
    const result = evaluateGate("high", "persistent_service", 0.7);
    expect(result.decision).toBe("auto_approve");
  });

  it("boundary: just below threshold (0.69) downgrades", () => {
    const result = evaluateGate("high", "persistent_service", 0.69);
    expect(result.decision).toBe("needs_approval");
  });

  it("uses custom confidence threshold when provided", () => {
    // With default threshold (0.7), 0.5 would downgrade
    const resultDefault = evaluateGate("high", "persistent_service", 0.5);
    expect(resultDefault.decision).toBe("needs_approval");

    // With a lower threshold (0.3), 0.5 should stay auto_approve
    const resultCustom = evaluateGate("high", "persistent_service", 0.5, 0.3);
    expect(resultCustom.decision).toBe("auto_approve");
  });

  it("custom threshold: exactly at threshold stays auto_approve", () => {
    const result = evaluateGate("high", "persistent_service", 0.5, 0.5);
    expect(result.decision).toBe("auto_approve");
  });

  it("custom threshold: just below threshold downgrades", () => {
    const result = evaluateGate("high", "persistent_service", 0.49, 0.5);
    expect(result.decision).toBe("needs_approval");
  });
});

// ---------------------------------------------------------------------------
// Gate evaluation result structure
// ---------------------------------------------------------------------------

describe("GateEvaluation structure", () => {
  it("returns all required fields", () => {
    const result = evaluateGate("medium", "ephemeral_compute");
    expect(result).toHaveProperty("decision");
    expect(result).toHaveProperty("reason");
    expect(result).toHaveProperty("level");
    expect(result).toHaveProperty("tier");
  });

  it("reason is human-readable", () => {
    const approved = evaluateGate("high", "cached_pattern");
    expect(approved.reason).toContain("Auto-approved");

    const needsApproval = evaluateGate("low", "irreversible");
    expect(needsApproval.reason).toContain("Approval required");
  });
});

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

describe("isValidAutonomyLevel", () => {
  it("accepts valid levels", () => {
    expect(isValidAutonomyLevel("low")).toBe(true);
    expect(isValidAutonomyLevel("medium")).toBe(true);
    expect(isValidAutonomyLevel("high")).toBe(true);
  });

  it("rejects invalid values", () => {
    expect(isValidAutonomyLevel("")).toBe(false);
    expect(isValidAutonomyLevel("max")).toBe(false);
    expect(isValidAutonomyLevel("LOW")).toBe(false);
  });
});

describe("parseAutonomyLevel", () => {
  it("parses valid levels", () => {
    expect(parseAutonomyLevel("low")).toBe("low");
    expect(parseAutonomyLevel("medium")).toBe("medium");
    expect(parseAutonomyLevel("high")).toBe("high");
  });

  it("falls back to low for undefined", () => {
    expect(parseAutonomyLevel(undefined)).toBe("low");
  });

  it("falls back to low for invalid string", () => {
    expect(parseAutonomyLevel("super")).toBe("low");
    expect(parseAutonomyLevel("")).toBe("low");
  });
});
