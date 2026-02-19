import { describe, expect, it, vi } from "vitest";
import { createReasoningTracerWithWriter } from "./tracer.js";
import type { ReasoningTrace } from "./types.js";
import type { TraceWriter } from "./writer.js";

function createMockWriter() {
  const traces: { sessionId: string; agentId: string | undefined; trace: ReasoningTrace }[] = [];
  const writer: TraceWriter = {
    write(sessionId, agentId, trace) {
      traces.push({ sessionId, agentId, trace });
    },
    async flush() {},
  };
  return { writer, traces };
}

describe("createReasoningTracerWithWriter", () => {
  it("produces a valid trace on finalize", () => {
    const { writer, traces } = createMockWriter();
    const tracer = createReasoningTracerWithWriter(writer, { enabled: true });

    const ctx = tracer.startDecision({
      userMessage: "hello world",
      sessionId: "sess-1",
      agentId: "agent-1",
      autonomyLevel: "medium",
      availableTools: ["read", "write"],
    });

    ctx.recordGateDecision({
      tool: "read",
      tier: "cached_pattern",
      classification: "read-only",
      decision: "auto_approve",
      confidence: 1,
      approvalRequired: false,
      approvalOutcome: "auto-approved",
    });

    ctx.recordToolOutcome({ tool: "read", success: true });

    ctx.recordLlmResponse({
      provider: "openai",
      model: "gpt-4",
      reasoning: "I need to read the file",
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 150,
      estimatedCostUsd: 0.003,
      stopReason: "end_turn",
    });

    ctx.finalize({ success: true, result: "File contents returned" });

    expect(traces).toHaveLength(1);
    const trace = traces[0].trace;

    expect(trace.id).toBe(ctx.traceId);
    expect(trace.input.userMessage).toBe("hello world");
    expect(trace.context.availableTools).toEqual(["read", "write"]);
    expect(trace.context.autonomyLevel).toBe("medium");
    expect(trace.context.activeUserModel).toBe("none");
    expect(trace.context.characterState).toBe("default");
    expect(trace.context.relevantMemories).toEqual([]);

    expect(trace.decision.action).toBe("read");
    expect(trace.decision.reasoning).toBe("I need to read the file");
    expect(trace.decision.classification).toBe("read-only");
    expect(trace.decision.approvalRequired).toBe(false);
    expect(trace.decision.approvalOutcome).toBe("auto-approved");
    expect(trace.decision.confidence).toBe(1);

    expect(trace.outcome.success).toBe(true);
    expect(trace.outcome.result).toBe("File contents returned");
    expect(trace.outcome.tokenCount).toBe(150);
    expect(trace.outcome.duration).toBeGreaterThanOrEqual(0);

    expect(traces[0].sessionId).toBe("sess-1");
    expect(traces[0].agentId).toBe("agent-1");
  });

  it("populates defaults for missing context", () => {
    const { writer, traces } = createMockWriter();
    const tracer = createReasoningTracerWithWriter(writer, { enabled: true });

    const ctx = tracer.startDecision({});
    ctx.finalize({ success: true });

    const trace = traces[0].trace;
    expect(trace.context.availableTools).toEqual([]);
    expect(trace.context.activeUserModel).toBe("none");
    expect(trace.context.characterState).toBe("default");
    expect(trace.context.autonomyLevel).toBe("low");
    expect(trace.context.relevantMemories).toEqual([]);
    expect(trace.decision.classification).toBe("unknown");
  });

  it("truncates long results", () => {
    const { writer, traces } = createMockWriter();
    const tracer = createReasoningTracerWithWriter(writer, {
      enabled: true,
      maxResultLength: 10,
    });

    const ctx = tracer.startDecision({});
    ctx.finalize({ success: true, result: "a".repeat(20) });

    expect(traces[0].trace.outcome.result).toBe("a".repeat(10) + "…");
  });

  it("omits reasoning when includeReasoning is false", () => {
    const { writer, traces } = createMockWriter();
    const tracer = createReasoningTracerWithWriter(writer, {
      enabled: true,
      includeReasoning: false,
    });

    const ctx = tracer.startDecision({});
    ctx.recordLlmResponse({
      reasoning: "secret thoughts",
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 15,
      estimatedCostUsd: 0,
    });
    ctx.finalize({ success: true });

    expect(traces[0].trace.decision.reasoning).toBe("");
  });

  it("records failure outcomes", () => {
    const { writer, traces } = createMockWriter();
    const tracer = createReasoningTracerWithWriter(writer, { enabled: true });

    const ctx = tracer.startDecision({ userMessage: "break things" });
    ctx.recordToolOutcome({ tool: "exec", success: false, error: "permission denied" });
    ctx.finalize({ success: false, error: "Tool failed" });

    const trace = traces[0].trace;
    expect(trace.outcome.success).toBe(false);
    expect(trace.outcome.error).toBe("Tool failed");
  });

  it("ignores recordings after finalize (idempotent)", () => {
    const { writer, traces } = createMockWriter();
    const tracer = createReasoningTracerWithWriter(writer, { enabled: true });

    const ctx = tracer.startDecision({});
    ctx.finalize({ success: true });
    ctx.finalize({ success: false, error: "double finalize" });
    ctx.recordToolOutcome({ tool: "read", success: true });

    expect(traces).toHaveLength(1);
    expect(traces[0].trace.outcome.success).toBe(true);
  });

  it("generates unique trace IDs per decision", () => {
    const { writer, traces } = createMockWriter();
    const tracer = createReasoningTracerWithWriter(writer, { enabled: true });

    const ctx1 = tracer.startDecision({});
    ctx1.finalize({ success: true });

    const ctx2 = tracer.startDecision({});
    ctx2.finalize({ success: true });

    expect(traces[0].trace.id).not.toBe(traces[1].trace.id);
  });

  it("records subtaskOf in input", () => {
    const { writer, traces } = createMockWriter();
    const tracer = createReasoningTracerWithWriter(writer, { enabled: true });

    const parent = tracer.startDecision({ userMessage: "do three things" });
    const parentId = parent.traceId;
    parent.finalize({ success: true });

    const child = tracer.startDecision({
      userMessage: "subtask 1",
      subtaskOf: parentId,
    });
    child.finalize({ success: true });

    expect(traces[1].trace.input.subtaskOf).toBe(parentId);
  });

  it("accumulates cost from multiple LLM responses", () => {
    const { writer, traces } = createMockWriter();
    const tracer = createReasoningTracerWithWriter(writer, { enabled: true });

    const ctx = tracer.startDecision({});
    ctx.recordLlmResponse({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 150,
      estimatedCostUsd: 0.002,
    });
    ctx.recordLlmResponse({
      inputTokens: 200,
      outputTokens: 100,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 300,
      estimatedCostUsd: 0.004,
    });
    ctx.finalize({ success: true });

    expect(traces[0].trace.outcome.tokenCount).toBe(450);
  });
});
