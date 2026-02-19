import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTraceWriter } from "./writer.js";
import type { ReasoningTrace } from "./types.js";

function makeTrace(id: string): ReasoningTrace {
  return {
    id,
    timestamp: new Date().toISOString(),
    input: { userMessage: "test" },
    context: {
      availableTools: [],
      activeUserModel: "none",
      characterState: "default",
      autonomyLevel: "low",
      relevantMemories: [],
    },
    decision: {
      action: "test",
      reasoning: "",
      confidence: 1,
      classification: "read-only",
      approvalRequired: false,
    },
    outcome: {
      success: true,
      duration: 10,
      tokenCount: 0,
      estimatedCost: 0,
    },
  };
}

describe("createTraceWriter", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "trace-writer-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("writes a trace as a JSONL line", async () => {
    const writer = createTraceWriter({ baseDir: tmpDir });
    writer.write("session-1", "agent-1", makeTrace("trace-1"));
    await writer.flush();

    const filePath = path.join(tmpDir, "agent-1", "session-1.jsonl");
    const content = await fs.readFile(filePath, "utf8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]) as ReasoningTrace;
    expect(parsed.id).toBe("trace-1");
    expect(parsed.input.userMessage).toBe("test");
  });

  it("appends multiple traces to the same session file", async () => {
    const writer = createTraceWriter({ baseDir: tmpDir });
    writer.write("session-1", "agent-1", makeTrace("trace-1"));
    writer.write("session-1", "agent-1", makeTrace("trace-2"));
    await writer.flush();

    const filePath = path.join(tmpDir, "agent-1", "session-1.jsonl");
    const content = await fs.readFile(filePath, "utf8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect((JSON.parse(lines[0]) as ReasoningTrace).id).toBe("trace-1");
    expect((JSON.parse(lines[1]) as ReasoningTrace).id).toBe("trace-2");
  });

  it("writes to separate files for different sessions", async () => {
    const writer = createTraceWriter({ baseDir: tmpDir });
    writer.write("session-a", "agent-1", makeTrace("trace-a"));
    writer.write("session-b", "agent-1", makeTrace("trace-b"));
    await writer.flush();

    const contentA = await fs.readFile(path.join(tmpDir, "agent-1", "session-a.jsonl"), "utf8");
    const contentB = await fs.readFile(path.join(tmpDir, "agent-1", "session-b.jsonl"), "utf8");
    expect((JSON.parse(contentA.trim()) as ReasoningTrace).id).toBe("trace-a");
    expect((JSON.parse(contentB.trim()) as ReasoningTrace).id).toBe("trace-b");
  });

  it("uses 'default' when agentId is undefined", async () => {
    const writer = createTraceWriter({ baseDir: tmpDir });
    writer.write("session-1", undefined, makeTrace("trace-1"));
    await writer.flush();

    const filePath = path.join(tmpDir, "default", "session-1.jsonl");
    const content = await fs.readFile(filePath, "utf8");
    expect(content.trim()).toBeTruthy();
  });

  it("creates directories automatically", async () => {
    const nestedDir = path.join(tmpDir, "deep", "nested");
    const writer = createTraceWriter({ baseDir: nestedDir });
    writer.write("session-1", "agent-1", makeTrace("trace-1"));
    await writer.flush();

    const filePath = path.join(nestedDir, "agent-1", "session-1.jsonl");
    const content = await fs.readFile(filePath, "utf8");
    expect(content.trim()).toBeTruthy();
  });
});
