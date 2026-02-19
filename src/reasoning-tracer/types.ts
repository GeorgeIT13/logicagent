/**
 * Reasoning Tracer type definitions.
 *
 * Implements the canonical ReasoningTrace interface from the project spec.
 * Every agent decision produces a structured trace that feeds into the
 * character system, memory, confidence calibration, and autonomy progression.
 */

import type { ActionTier, AutonomyLevel, GateDecision } from "../autonomy/types.js";

/**
 * User-facing classification vocabulary from the project spec.
 * Mapped from the internal ActionTier via `classification.ts`.
 */
export type TraceClassification =
  | "read-only"
  | "reversible-write"
  | "create-infrastructure"
  | "irreversible"
  | "unknown";

/** Approval outcome for a gated action. */
export type ApprovalOutcome = "approved" | "rejected" | "auto-approved";

/** User satisfaction signal detected from interaction patterns. */
export type UserSatisfactionSignal = "accepted" | "modified" | "rejected" | "no-signal";

/**
 * A complete reasoning trace record. One per agent decision.
 * Stored as a single JSONL line in per-session trace files.
 */
export interface ReasoningTrace {
  id: string;
  timestamp: string; // ISO 8601

  input: {
    userMessage?: string;
    systemEvent?: string;
    /** Parent trace ID when this is a decomposed subtask. */
    subtaskOf?: string;
  };

  context: {
    availableTools: string[];
    /** Reference to user model snapshot (path or "none" until Phase 4). */
    activeUserModel: string;
    /** Current personality configuration (serialized or "default" until Phase 3). */
    characterState: string;
    autonomyLevel: string;
    /** Memory references (empty until Phase 4). */
    relevantMemories: string[];
  };

  decision: {
    action: string;
    /** LLM's stated reasoning extracted from the response. */
    reasoning: string;
    /** Confidence score 0-1. */
    confidence: number;
    classification: TraceClassification;
    approvalRequired: boolean;
    approvalOutcome?: ApprovalOutcome;
  };

  outcome: {
    success: boolean;
    /** Truncated result summary. */
    result?: string;
    error?: string;
    /** Duration in milliseconds. */
    duration: number;
    tokenCount: number;
    /** Estimated cost in USD. */
    estimatedCost: number;
  };

  /** Populated by Phase 3 self-reflection hooks; left undefined until then. */
  reflection?: {
    qualityScore: number;
    alternativesConsidered: string[];
    lessonsLearned: string;
    userSatisfactionSignal?: UserSatisfactionSignal;
  };
}

/** Parameters for starting a new decision trace. */
export interface StartDecisionParams {
  userMessage?: string;
  systemEvent?: string;
  subtaskOf?: string;
  sessionId?: string;
  sessionKey?: string;
  agentId?: string;

  availableTools?: string[];
  autonomyLevel?: AutonomyLevel | string;
  activeUserModel?: string;
  characterState?: string;
  relevantMemories?: string[];
}

/** A recorded gate decision within a trace. */
export interface TraceGateRecord {
  tool: string;
  tier: ActionTier;
  classification: TraceClassification;
  decision: GateDecision;
  confidence?: number;
  approvalRequired: boolean;
  approvalOutcome?: ApprovalOutcome;
}

/** A recorded tool execution outcome within a trace. */
export interface TraceToolOutcome {
  tool: string;
  success: boolean;
  error?: string;
}

/** Accumulated LLM usage for a decision. */
export interface TraceLlmRecord {
  provider?: string;
  model?: string;
  reasoning?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  stopReason?: string;
}

/**
 * Handle returned by `tracer.startDecision()`. Callers use this to
 * incrementally record gate decisions, tool outcomes, and LLM responses
 * within a single agent decision, then finalize the trace.
 */
export interface TraceContext {
  /** Unique ID for this trace — can be attached to Autonomy Gate requests. */
  readonly traceId: string;

  /** Record an Autonomy Gate evaluation for a tool call. */
  recordGateDecision(record: TraceGateRecord): void;

  /** Record the outcome of a tool execution. */
  recordToolOutcome(outcome: TraceToolOutcome): void;

  /** Record LLM response metadata and usage. */
  recordLlmResponse(record: TraceLlmRecord): void;

  /** Finalize and write the complete trace. */
  finalize(outcome: { success: boolean; result?: string; error?: string }): void;
}

/** Parameters for querying traces. */
export interface TraceQueryParams {
  /** Full-text keyword search across userMessage, action, reasoning. */
  keyword?: string;
  sessionId?: string;
  agentId?: string;
  classification?: TraceClassification;
  startTime?: string; // ISO 8601
  endTime?: string; // ISO 8601
  subtaskOf?: string;
  sortBy?: "timestamp" | "cost" | "duration";
  sortOrder?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

/** Result of a trace query. */
export interface TraceQueryResult {
  traces: ReasoningTrace[];
  total: number;
}
