import { describe, expect, it } from "vitest";
import { mapActionTierToClassification, mapClassificationToActionTier } from "./classification.js";
import type { ActionTier } from "../autonomy/types.js";
import type { TraceClassification } from "./types.js";

describe("mapActionTierToClassification", () => {
  it("maps cached_pattern to read-only", () => {
    expect(mapActionTierToClassification("cached_pattern")).toBe("read-only");
  });

  it("maps ephemeral_compute to reversible-write", () => {
    expect(mapActionTierToClassification("ephemeral_compute")).toBe("reversible-write");
  });

  it("maps persistent_service to create-infrastructure", () => {
    expect(mapActionTierToClassification("persistent_service")).toBe("create-infrastructure");
  });

  it("maps sandboxed_workspace to create-infrastructure", () => {
    expect(mapActionTierToClassification("sandboxed_workspace")).toBe("create-infrastructure");
  });

  it("maps irreversible to irreversible", () => {
    expect(mapActionTierToClassification("irreversible")).toBe("irreversible");
  });

  it("maps unknown tiers to unknown", () => {
    expect(mapActionTierToClassification("not_a_real_tier" as ActionTier)).toBe("unknown");
  });
});

describe("mapClassificationToActionTier", () => {
  it("maps read-only to cached_pattern", () => {
    expect(mapClassificationToActionTier("read-only")).toBe("cached_pattern");
  });

  it("maps reversible-write to ephemeral_compute", () => {
    expect(mapClassificationToActionTier("reversible-write")).toBe("ephemeral_compute");
  });

  it("maps create-infrastructure to persistent_service", () => {
    expect(mapClassificationToActionTier("create-infrastructure")).toBe("persistent_service");
  });

  it("maps irreversible to irreversible", () => {
    expect(mapClassificationToActionTier("irreversible")).toBe("irreversible");
  });

  it("maps unknown to irreversible (safety default)", () => {
    expect(mapClassificationToActionTier("unknown")).toBe("irreversible");
  });

  const classifications: TraceClassification[] = [
    "read-only",
    "reversible-write",
    "create-infrastructure",
    "irreversible",
    "unknown",
  ];
  for (const cls of classifications) {
    it(`roundtrips through classification: ${cls}`, () => {
      const tier = mapClassificationToActionTier(cls);
      const backToClassification = mapActionTierToClassification(tier);
      // Not strictly a roundtrip for "unknown" or "sandboxed_workspace" mappings,
      // but the safety direction should be preserved.
      if (cls === "unknown") {
        expect(backToClassification).toBe("irreversible");
      } else {
        expect(backToClassification).toBe(cls);
      }
    });
  }
});
