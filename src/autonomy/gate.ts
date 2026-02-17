/**
 * Autonomy Gate — the safety foundation (Layer 1).
 *
 * Evaluates whether a tool call should be auto-approved, queued for user
 * approval, or denied outright, based on the user's autonomy level and
 * the classified action tier.
 *
 * Policy matrix (from PROJECT_INSTRUCTIONS.md):
 *
 *   Low:    only cached_pattern auto-approved; everything else needs approval.
 *   Medium: cached_pattern + ephemeral_compute auto-approved; higher tiers need approval.
 *   High:   all tiers auto-approved except irreversible (always needs confirmation).
 */

import type {
  ActionTier,
  AutonomyLevel,
  AutonomyPolicy,
  GateDecision,
  GateEvaluation,
} from "./types.js";

/**
 * The full policy matrix. Each row is an autonomy level, each column is an
 * action tier. The value is the gate decision.
 */
export const AUTONOMY_POLICY: AutonomyPolicy = {
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

/** Human-readable descriptions of each action tier. */
const TIER_DESCRIPTIONS: Record<ActionTier, string> = {
  cached_pattern: "read-only operation with no side effects",
  ephemeral_compute: "stateless write with bounded impact",
  persistent_service: "long-running or infrastructure-level operation",
  sandboxed_workspace: "complex multi-step sandboxed environment",
  irreversible: "externally-visible or destructive action",
};

/** Default confidence threshold — can be overridden via config. */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;

/**
 * Evaluate the autonomy gate for a specific action.
 *
 * @param level - The user's configured autonomy level.
 * @param tier - The classified action tier from the classifier.
 * @param confidence - Optional confidence score (0-1) from the classifier.
 *   When confidence is low and the decision would be auto_approve,
 *   the gate downgrades to needs_approval.
 * @param confidenceThreshold - Configurable threshold (default 0.7). Actions
 *   with confidence below this will require approval even if the policy matrix
 *   says auto_approve.
 * @returns Full evaluation with decision and reasoning.
 */
export function evaluateGate(
  level: AutonomyLevel,
  tier: ActionTier,
  confidence?: number,
  confidenceThreshold: number = DEFAULT_CONFIDENCE_THRESHOLD,
): GateEvaluation {
  const baseDecision = AUTONOMY_POLICY[level][tier];
  const tierDescription = TIER_DESCRIPTIONS[tier];

  // Low-confidence safety net: if the classifier isn't sure about the tier
  // and the base decision would auto-approve, downgrade to needs_approval.
  if (
    baseDecision === "auto_approve" &&
    confidence !== undefined &&
    confidence < confidenceThreshold
  ) {
    return {
      decision: "needs_approval",
      reason:
        `Classification confidence (${(confidence * 100).toFixed(0)}%) is below threshold ` +
        `for auto-approval of ${tierDescription}. Requesting user confirmation.`,
      level,
      tier,
      confidence,
    };
  }

  const reason =
    baseDecision === "auto_approve"
      ? `Auto-approved: ${tierDescription} is within ${level}-autonomy grant.`
      : `Approval required: ${tierDescription} exceeds ${level}-autonomy grant.`;

  return {
    decision: baseDecision,
    reason,
    level,
    tier,
    confidence,
  };
}

/** Validate that a string is a valid AutonomyLevel. */
export function isValidAutonomyLevel(value: string): value is AutonomyLevel {
  return value === "low" || value === "medium" || value === "high";
}

/** Parse an autonomy level string with fallback to "low". */
export function parseAutonomyLevel(value: string | undefined): AutonomyLevel {
  if (value && isValidAutonomyLevel(value)) {
    return value;
  }
  return "low";
}
