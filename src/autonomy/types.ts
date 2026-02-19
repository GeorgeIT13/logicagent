/**
 * Autonomy Gate type definitions.
 *
 * The Autonomy Gate is the safety foundation (Layer 1) that gates all tool
 * execution based on configurable per-user trust levels. Every tool call
 * passes through the gate before execution.
 */

/** Configurable autonomy level per user. */
export type AutonomyLevel = "low" | "medium" | "high";

/**
 * Classification of a tool action by its impact tier.
 *
 * - `cached_pattern`: Read-only, no side effects (file reads, searches, web fetches).
 * - `ephemeral_compute`: Stateless writes with bounded impact (file writes, short-lived commands).
 * - `persistent_service`: Long-running or infrastructure-level (deploy, provision, DB writes).
 * - `sandboxed_workspace`: Complex multi-step environments (builds, browser automation).
 * - `irreversible`: Destructive or externally-visible (deletions, payments, outbound messages).
 */
export type ActionTier =
  | "cached_pattern"
  | "ephemeral_compute"
  | "persistent_service"
  | "sandboxed_workspace"
  | "irreversible";

/** Decision returned by the autonomy gate for a given action. */
export type GateDecision = "auto_approve" | "needs_approval" | "denied";

/** Result of evaluating the gate, including reasoning context. */
export interface GateEvaluation {
  decision: GateDecision;
  /** Why this decision was made (human-readable). */
  reason: string;
  /** The autonomy level that was applied. */
  level: AutonomyLevel;
  /** The action tier that was classified. */
  tier: ActionTier;
  /**
   * Confidence that this classification is correct (0-1).
   * Surfaced when operating near the autonomy boundary.
   */
  confidence?: number;
}

/**
 * Policy matrix entry: maps an (AutonomyLevel, ActionTier) pair to a GateDecision.
 * The full matrix is defined in gate.ts.
 */
export type AutonomyPolicy = Record<AutonomyLevel, Record<ActionTier, GateDecision>>;

/** Metadata a tool can declare to override the default classifier. */
export interface ToolAutonomyHint {
  /** Explicit tier override — skips the classifier. */
  tier: ActionTier;
  /** Optional human-readable reason for the classification. */
  reason?: string;
}

/**
 * Declared access scope for a tool. The Autonomy Gate enforces these scopes
 * at execution time — a tool cannot exceed its declared scope even if the
 * global security config allows broader access.
 */
export interface ToolAccessScope {
  /** Filesystem paths this tool is allowed to access (resolved with ~ expansion). */
  filesystemPaths?: string[];
  /** Network endpoints (hostnames or URL patterns) this tool may contact. */
  networkEndpoints?: string[];
  /** Data categories this tool handles: "code", "text", "user-data", "metadata". */
  dataCategories?: string[];
}
