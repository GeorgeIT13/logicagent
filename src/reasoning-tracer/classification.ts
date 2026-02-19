/**
 * Classification mapping between the Autonomy Gate's internal ActionTier
 * vocabulary and the spec's user-facing classification vocabulary.
 *
 * Centralized here so all consumers (tracer, character system, autonomy
 * progression) use consistent terminology.
 */

import type { ActionTier } from "../autonomy/types.js";
import type { TraceClassification } from "./types.js";

const TIER_TO_CLASSIFICATION: Record<ActionTier, TraceClassification> = {
  cached_pattern: "read-only",
  ephemeral_compute: "reversible-write",
  persistent_service: "create-infrastructure",
  sandboxed_workspace: "create-infrastructure",
  irreversible: "irreversible",
};

const CLASSIFICATION_TO_TIER: Record<TraceClassification, ActionTier> = {
  "read-only": "cached_pattern",
  "reversible-write": "ephemeral_compute",
  "create-infrastructure": "persistent_service",
  irreversible: "irreversible",
  // "unknown" has no direct tier — map to irreversible as the safety default
  unknown: "irreversible",
};

/** Map an internal ActionTier to the spec's classification vocabulary. */
export function mapActionTierToClassification(tier: ActionTier): TraceClassification {
  return TIER_TO_CLASSIFICATION[tier] ?? "unknown";
}

/** Map a spec classification back to an ActionTier (best-effort). */
export function mapClassificationToActionTier(classification: TraceClassification): ActionTier {
  return CLASSIFICATION_TO_TIER[classification] ?? "irreversible";
}
