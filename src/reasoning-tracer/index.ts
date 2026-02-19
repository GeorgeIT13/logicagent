/**
 * Reasoning Tracer — public API.
 *
 * Captures structured per-decision traces that feed into the character
 * system, memory, confidence calibration, and autonomy progression.
 */

// Core types
export type {
  ApprovalOutcome,
  ReasoningTrace,
  StartDecisionParams,
  TraceClassification,
  TraceContext,
  TraceGateRecord,
  TraceLlmRecord,
  TraceQueryParams,
  TraceQueryResult,
  TraceToolOutcome,
  UserSatisfactionSignal,
} from "./types.js";

// Classification mapping
export { mapActionTierToClassification, mapClassificationToActionTier } from "./classification.js";

// Cost tracker
export { createDecisionCostTracker, type CostSnapshot, type DecisionCostTracker } from "./cost-tracker.js";

// Tracer
export {
  createReasoningTracer,
  createReasoningTracerWithWriter,
  type ReasoningTracer,
  type ReasoningTracerConfig,
} from "./tracer.js";

// Writer
export { createTraceWriter, type TraceWriter, type TraceWriterConfig } from "./writer.js";

// Task decomposition
export {
  decomposeTask,
  type DecompositionResult,
  type Subtask,
} from "./task-decomposer.js";

// Query interface
export { getSubtasks, getTrace, queryTraces } from "./query.js";

// Active trace context (for cross-module integration)
export { getActiveTraceContext, setActiveTraceContext } from "./active-context.js";
