import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getSubtasks, getTrace, queryTraces } from "./query.js";
import type { ReasoningTrace } from "./types.js";

function makeTrace(overrides: Partial<ReasoningTrace> & { id: string }): ReasoningTrace {
  return {
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
    ...overrides,
  };
}

describe("query", () => {
  let tmpDir: string;
  let agentDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "trace-query-test-"));
    agentDir = path.join(tmpDir, "agent-1");
    await fs.mkdir(agentDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function writeTraces(sessionId: string, traces: ReasoningTrace[]): Promise<void> {
    const lines = traces.map((t) => JSON.stringify(t)).join("\n") + "\n";
    await fs.writeFile(path.join(agentDir, `${sessionId}.jsonl`), lines, "utf8");
  }

  describe("queryTraces", () => {
    it("returns all traces from a session", async () => {
      const t1 = makeTrace({ id: "t1" });
      const t2 = makeTrace({ id: "t2" });
      await writeTraces("session-1", [t1, t2]);

      const result = await queryTraces({
        sessionId: "session-1",
        agentId: "agent-1",
        baseDir: tmpDir,
      });
      expect(result.total).toBe(2);
      expect(result.traces.map((t) => t.id)).toContain("t1");
      expect(result.traces.map((t) => t.id)).toContain("t2");
    });

    it("filters by keyword in userMessage", async () => {
      const t1 = makeTrace({ id: "t1", input: { userMessage: "deploy production" } });
      const t2 = makeTrace({ id: "t2", input: { userMessage: "read config" } });
      await writeTraces("s1", [t1, t2]);

      const result = await queryTraces({
        keyword: "deploy",
        agentId: "agent-1",
        baseDir: tmpDir,
      });
      expect(result.total).toBe(1);
      expect(result.traces[0].id).toBe("t1");
    });

    it("filters by classification", async () => {
      const t1 = makeTrace({
        id: "t1",
        decision: {
          action: "read",
          reasoning: "",
          confidence: 1,
          classification: "read-only",
          approvalRequired: false,
        },
      });
      const t2 = makeTrace({
        id: "t2",
        decision: {
          action: "exec",
          reasoning: "",
          confidence: 1,
          classification: "irreversible",
          approvalRequired: true,
        },
      });
      await writeTraces("s1", [t1, t2]);

      const result = await queryTraces({
        classification: "irreversible",
        agentId: "agent-1",
        baseDir: tmpDir,
      });
      expect(result.total).toBe(1);
      expect(result.traces[0].id).toBe("t2");
    });

    it("filters by time range", async () => {
      const t1 = makeTrace({ id: "t1", timestamp: "2025-01-01T00:00:00Z" });
      const t2 = makeTrace({ id: "t2", timestamp: "2025-06-01T00:00:00Z" });
      const t3 = makeTrace({ id: "t3", timestamp: "2025-12-01T00:00:00Z" });
      await writeTraces("s1", [t1, t2, t3]);

      const result = await queryTraces({
        startTime: "2025-03-01T00:00:00Z",
        endTime: "2025-09-01T00:00:00Z",
        agentId: "agent-1",
        baseDir: tmpDir,
      });
      expect(result.total).toBe(1);
      expect(result.traces[0].id).toBe("t2");
    });

    it("sorts by cost descending", async () => {
      const t1 = makeTrace({
        id: "t1",
        outcome: { success: true, duration: 10, tokenCount: 0, estimatedCost: 0.01 },
      });
      const t2 = makeTrace({
        id: "t2",
        outcome: { success: true, duration: 10, tokenCount: 0, estimatedCost: 0.1 },
      });
      await writeTraces("s1", [t1, t2]);

      const result = await queryTraces({
        sortBy: "cost",
        sortOrder: "desc",
        agentId: "agent-1",
        baseDir: tmpDir,
      });
      expect(result.traces[0].id).toBe("t2");
      expect(result.traces[1].id).toBe("t1");
    });

    it("respects limit and offset", async () => {
      const traces = Array.from({ length: 5 }, (_, i) =>
        makeTrace({ id: `t${i}`, timestamp: `2025-01-0${i + 1}T00:00:00Z` }),
      );
      await writeTraces("s1", traces);

      const result = await queryTraces({
        sortBy: "timestamp",
        sortOrder: "asc",
        limit: 2,
        offset: 1,
        agentId: "agent-1",
        baseDir: tmpDir,
      });
      expect(result.total).toBe(5);
      expect(result.traces).toHaveLength(2);
      expect(result.traces[0].id).toBe("t1");
      expect(result.traces[1].id).toBe("t2");
    });

    it("returns empty for non-existent agent", async () => {
      const result = await queryTraces({
        agentId: "nonexistent",
        baseDir: tmpDir,
      });
      expect(result.total).toBe(0);
      expect(result.traces).toEqual([]);
    });
  });

  describe("getTrace", () => {
    it("finds a trace by ID", async () => {
      await writeTraces("s1", [makeTrace({ id: "target" }), makeTrace({ id: "other" })]);

      const trace = await getTrace("target", { agentId: "agent-1", baseDir: tmpDir });
      expect(trace).toBeTruthy();
      expect(trace!.id).toBe("target");
    });

    it("returns null for missing trace ID", async () => {
      await writeTraces("s1", [makeTrace({ id: "other" })]);

      const trace = await getTrace("missing", { agentId: "agent-1", baseDir: tmpDir });
      expect(trace).toBeNull();
    });
  });

  describe("getSubtasks", () => {
    it("returns subtasks for a parent trace", async () => {
      const parent = makeTrace({ id: "parent" });
      const child1 = makeTrace({ id: "child1", input: { subtaskOf: "parent" } });
      const child2 = makeTrace({ id: "child2", input: { subtaskOf: "parent" } });
      const unrelated = makeTrace({ id: "unrelated" });
      await writeTraces("s1", [parent, child1, child2, unrelated]);

      const subtasks = await getSubtasks("parent", { agentId: "agent-1", baseDir: tmpDir });
      expect(subtasks).toHaveLength(2);
      expect(subtasks.map((s) => s.id).sort()).toEqual(["child1", "child2"]);
    });

    it("returns empty for a trace with no subtasks", async () => {
      await writeTraces("s1", [makeTrace({ id: "lonely" })]);

      const subtasks = await getSubtasks("lonely", { agentId: "agent-1", baseDir: tmpDir });
      expect(subtasks).toEqual([]);
    });
  });
});
