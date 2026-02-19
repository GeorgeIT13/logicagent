/**
 * Core Reasoning Tracer.
 *
 * Factory creates a tracer (or null when disabled). Each agent decision
 * gets a TraceContext handle for incrementally recording gate decisions,
 * tool outcomes, and LLM responses, then finalizing the trace to JSONL.
 */

import crypto from "node:crypto";
import type { OpenClawConfig } from "../config/config.js";
import type {
  ReasoningTrace,
  StartDecisionParams,
  TraceContext,
  TraceGateRecord,
  TraceLlmRecord,
  TraceToolOutcome,
} from "./types.js";
import { createDecisionCostTracker, type DecisionCostTracker } from "./cost-tracker.js";
import { createTraceWriter, type TraceWriter } from "./writer.js";

export interface ReasoningTracerConfig {
  enabled?: boolean;
  baseDir?: string;
  /** Include LLM reasoning text in traces. Default true. */
  includeReasoning?: boolean;
  /** Max length for outcome.result truncation. Default 2000. */
  maxResultLength?: number;
}

export interface ReasoningTracer {
  /** Start a new decision trace. Returns a context handle. */
  startDecision(params: StartDecisionParams): TraceContext;
  /** Flush all pending writes. */
  flush(): Promise<void>;
}

function resolveConfig(config?: OpenClawConfig): ReasoningTracerConfig {
  const section = (config as Record<string, unknown> | undefined)?.diagnostics as
    | Record<string, unknown>
    | undefined;
  const rt = section?.reasoningTrace as ReasoningTracerConfig | undefined;
  return {
    enabled: rt?.enabled ?? false,
    baseDir: rt?.baseDir,
    includeReasoning: rt?.includeReasoning ?? true,
    maxResultLength: rt?.maxResultLength ?? 2000,
  };
}

/**
 * Create a reasoning tracer. Returns null when tracing is disabled —
 * callers should use optional chaining (e.g. `tracer?.startDecision(...)`).
 */
export function createReasoningTracer(config?: OpenClawConfig): ReasoningTracer | null {
  const cfg = resolveConfig(config);
  if (!cfg.enabled) {
    return null;
  }

  const writer = createTraceWriter({ baseDir: cfg.baseDir });
  return createReasoningTracerWithWriter(writer, cfg);
}

/** Variant accepting an injected writer — used in tests. */
export function createReasoningTracerWithWriter(
  writer: TraceWriter,
  config: ReasoningTracerConfig,
): ReasoningTracer {
  const maxResultLen = config.maxResultLength ?? 2000;
  const includeReasoning = config.includeReasoning ?? true;

  function startDecision(params: StartDecisionParams): TraceContext {
    const traceId = crypto.randomUUID();
    const startTime = Date.now();
    const gateRecords: TraceGateRecord[] = [];
    const toolOutcomes: TraceToolOutcome[] = [];
    const costTracker: DecisionCostTracker = createDecisionCostTracker();
    let llmRecord: TraceLlmRecord | undefined;
    let finalized = false;

    const sessionId = params.sessionId ?? "unknown";
    const agentId = params.agentId;

    const context: TraceContext = {
      traceId,

      recordGateDecision(record: TraceGateRecord): void {
        if (finalized) return;
        gateRecords.push(record);
      },

      recordToolOutcome(outcome: TraceToolOutcome): void {
        if (finalized) return;
        toolOutcomes.push(outcome);
      },

      recordLlmResponse(record: TraceLlmRecord): void {
        if (finalized) return;
        llmRecord = record;
        costTracker.addUsage({
          usage: {
            input: record.inputTokens,
            output: record.outputTokens,
            cacheRead: record.cacheReadTokens,
            cacheWrite: record.cacheWriteTokens,
            total: record.totalTokens,
          },
          provider: record.provider,
          model: record.model,
        });
      },

      finalize(outcome: { success: boolean; result?: string; error?: string }): void {
        if (finalized) return;
        finalized = true;

        const durationMs = Date.now() - startTime;
        const costSnapshot = costTracker.snapshot();

        // Determine primary gate decision for the trace's decision block
        const primaryGate = gateRecords[0];
        const hasApproval = gateRecords.some((g) => g.approvalRequired);
        const approvalOutcome = primaryGate?.approvalOutcome;

        let resultText = outcome.result;
        if (resultText && resultText.length > maxResultLen) {
          resultText = resultText.slice(0, maxResultLen) + "…";
        }

        const trace: ReasoningTrace = {
          id: traceId,
          timestamp: new Date(startTime).toISOString(),

          input: {
            userMessage: params.userMessage,
            systemEvent: params.systemEvent,
            subtaskOf: params.subtaskOf,
          },

          context: {
            availableTools: params.availableTools ?? [],
            activeUserModel: params.activeUserModel ?? "none",
            characterState: params.characterState ?? "default",
            autonomyLevel: params.autonomyLevel ?? "low",
            relevantMemories: params.relevantMemories ?? [],
          },

          decision: {
            action: primaryGate?.tool ?? llmRecord?.stopReason ?? "response",
            reasoning: includeReasoning ? (llmRecord?.reasoning ?? "") : "",
            confidence: primaryGate?.confidence ?? 1,
            classification: primaryGate?.classification ?? "unknown",
            approvalRequired: hasApproval,
            approvalOutcome,
          },

          outcome: {
            success: outcome.success,
            result: resultText,
            error: outcome.error,
            duration: durationMs,
            tokenCount: costSnapshot.totalTokens,
            estimatedCost: costSnapshot.estimatedCostUsd,
          },
        };

        writer.write(sessionId, agentId, trace);
      },
    };

    return context;
  }

  return {
    startDecision,
    flush: () => writer.flush(),
  };
}
