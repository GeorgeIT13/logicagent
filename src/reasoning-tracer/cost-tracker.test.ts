import { describe, expect, it } from "vitest";
import { createDecisionCostTracker } from "./cost-tracker.js";

describe("createDecisionCostTracker", () => {
  it("starts with zero totals", () => {
    const tracker = createDecisionCostTracker();
    const snap = tracker.snapshot();
    expect(snap.inputTokens).toBe(0);
    expect(snap.outputTokens).toBe(0);
    expect(snap.cacheReadTokens).toBe(0);
    expect(snap.cacheWriteTokens).toBe(0);
    expect(snap.totalTokens).toBe(0);
    expect(snap.estimatedCostUsd).toBe(0);
  });

  it("accumulates token counts from usage", () => {
    const tracker = createDecisionCostTracker();
    tracker.addUsage({
      usage: { input: 100, output: 50, cacheRead: 10, cacheWrite: 5 },
    });
    const snap = tracker.snapshot();
    expect(snap.inputTokens).toBe(100);
    expect(snap.outputTokens).toBe(50);
    expect(snap.cacheReadTokens).toBe(10);
    expect(snap.cacheWriteTokens).toBe(5);
    expect(snap.totalTokens).toBe(165);
  });

  it("accumulates across multiple addUsage calls", () => {
    const tracker = createDecisionCostTracker();
    tracker.addUsage({ usage: { input: 100, output: 50 } });
    tracker.addUsage({ usage: { input: 200, output: 100 } });
    const snap = tracker.snapshot();
    expect(snap.inputTokens).toBe(300);
    expect(snap.outputTokens).toBe(150);
    expect(snap.totalTokens).toBe(450);
  });

  it("handles null/undefined usage gracefully", () => {
    const tracker = createDecisionCostTracker();
    tracker.addUsage({ usage: null });
    tracker.addUsage({ usage: undefined });
    tracker.addUsage({});
    const snap = tracker.snapshot();
    expect(snap.totalTokens).toBe(0);
    expect(snap.estimatedCostUsd).toBe(0);
  });

  it("handles partial usage fields", () => {
    const tracker = createDecisionCostTracker();
    tracker.addUsage({ usage: { input: 50 } });
    const snap = tracker.snapshot();
    expect(snap.inputTokens).toBe(50);
    expect(snap.outputTokens).toBe(0);
    expect(snap.totalTokens).toBe(50);
  });
});
