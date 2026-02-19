/**
 * Type definitions for the Autonomy Gate approval pipeline.
 *
 * The approval pipeline queues tool calls that exceed the user's autonomy
 * level, surfaces them to the user for a decision (allow-once / allow-always /
 * deny), and optionally persists "Approve & Remember" rules for future runs.
 */

import type { ActionTier, AutonomyLevel } from "./types.js";

// ---------------------------------------------------------------------------
// Approval decisions
// ---------------------------------------------------------------------------

/**
 * Decision a user can make on a queued autonomy approval.
 *
 * - `allow-once`:   Execute this action, don't remember the decision.
 * - `allow-always`: Execute and create a persistent auto-approve rule.
 * - `deny`:         Block this action and return an error to the agent.
 */
export type AutonomyApprovalDecision = "allow-once" | "allow-always" | "deny";

// ---------------------------------------------------------------------------
// Approval request payload — what the agent wants to do
// ---------------------------------------------------------------------------

export type AutonomyApprovalRequestPayload = {
  /** Tool name (normalised). */
  toolName: string;
  /** Stringified summary of the tool call parameters (truncated for safety). */
  paramsSummary: string;
  /** The classified action tier. */
  tier: ActionTier;
  /** The autonomy level that was applied when the gate evaluated. */
  level: AutonomyLevel;
  /** Human-readable reason from the gate evaluation. */
  gateReason: string;
  /** Confidence score (0-1) from the classifier, if available. */
  confidence?: number;
  /** Agent ID that requested the tool call. */
  agentId?: string | null;
  /** Session key for the conversation that triggered this action. */
  sessionKey?: string | null;
  /** Reasoning trace ID for bidirectional trace-gate linkage. */
  traceId?: string | null;
};

// ---------------------------------------------------------------------------
// Approval record — full lifecycle state
// ---------------------------------------------------------------------------

export type AutonomyApprovalRecord = {
  id: string;
  request: AutonomyApprovalRequestPayload;
  createdAtMs: number;
  expiresAtMs: number;
  /** Caller metadata (best-effort). */
  requestedByConnId?: string | null;
  requestedByDeviceId?: string | null;
  requestedByClientId?: string | null;
  /** Set once the approval is resolved (by user action or timeout). */
  resolvedAtMs?: number;
  decision?: AutonomyApprovalDecision;
  resolvedBy?: string | null;
};

// ---------------------------------------------------------------------------
// Gateway events — for forwarding / UI consumption
// ---------------------------------------------------------------------------

export type AutonomyApprovalRequestEvent = {
  id: string;
  request: AutonomyApprovalRequestPayload;
  createdAtMs: number;
  expiresAtMs: number;
};

export type AutonomyApprovalResolvedEvent = {
  id: string;
  decision: AutonomyApprovalDecision;
  resolvedBy?: string | null;
  ts: number;
};

// ---------------------------------------------------------------------------
// Persistent auto-approve rules ("Approve & Remember")
// ---------------------------------------------------------------------------

export type AutonomyAutoApproveRule = {
  /** Unique rule ID. */
  id: string;
  /**
   * Tool name pattern to match. Exact match by default.
   * Supports trailing glob: `exec*` matches `exec`, `exec_bash`, etc.
   */
  toolPattern: string;
  /** The minimum action tier this rule covers. */
  tier: ActionTier;
  /** When this rule was created. */
  createdAtMs: number;
  /** When this rule was last used to auto-approve an action. */
  lastUsedAtMs?: number;
  /** How many times this rule has been used. */
  useCount: number;
};

export type AutonomyAutoApproveAgent = {
  rules?: AutonomyAutoApproveRule[];
};

/**
 * Versioned file format for persistent auto-approve rules.
 * Stored at `~/.logicagent/autonomy-rules.json`.
 * Mirrors the `ExecApprovalsFile` pattern from exec-approvals.
 */
export type AutonomyAutoApproveFile = {
  version: 1;
  /** Per-agent rule sets. Key is agent ID (e.g. "main"). */
  agents?: Record<string, AutonomyAutoApproveAgent>;
};
