/**
 * Trace query interface.
 *
 * Allows the agent to search its own reasoning trace history.
 * Reads per-session JSONL files and supports filtering by keyword,
 * time range, session, classification, and subtask relationships.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import type {
  ReasoningTrace,
  TraceClassification,
  TraceQueryParams,
  TraceQueryResult,
} from "./types.js";
import { resolveStateDir } from "../config/paths.js";

function resolveTracesBaseDir(baseDir?: string): string {
  return baseDir ?? path.join(resolveStateDir(), "traces");
}

function resolveAgentDir(agentId: string | undefined, baseDir?: string): string {
  return path.join(resolveTracesBaseDir(baseDir), agentId ?? "default");
}

async function* readJsonlTraces(filePath: string): AsyncGenerator<ReasoningTrace> {
  const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (parsed && typeof parsed === "object" && "id" in parsed && "timestamp" in parsed) {
          yield parsed as ReasoningTrace;
        }
      } catch {
        // Skip malformed lines
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }
}

function matchesKeyword(trace: ReasoningTrace, keyword: string): boolean {
  const lower = keyword.toLowerCase();
  return (
    (trace.input.userMessage?.toLowerCase().includes(lower) ?? false) ||
    trace.decision.action.toLowerCase().includes(lower) ||
    trace.decision.reasoning.toLowerCase().includes(lower)
  );
}

function matchesFilters(trace: ReasoningTrace, params: TraceQueryParams): boolean {
  if (params.keyword && !matchesKeyword(trace, params.keyword)) {
    return false;
  }
  if (params.classification && trace.decision.classification !== params.classification) {
    return false;
  }
  if (params.subtaskOf && trace.input.subtaskOf !== params.subtaskOf) {
    return false;
  }
  if (params.startTime) {
    const traceTs = new Date(trace.timestamp).getTime();
    const startTs = new Date(params.startTime).getTime();
    if (traceTs < startTs) return false;
  }
  if (params.endTime) {
    const traceTs = new Date(trace.timestamp).getTime();
    const endTs = new Date(params.endTime).getTime();
    if (traceTs > endTs) return false;
  }
  return true;
}

function compareTraces(
  a: ReasoningTrace,
  b: ReasoningTrace,
  sortBy: string,
  sortOrder: string,
): number {
  let diff = 0;
  switch (sortBy) {
    case "cost":
      diff = a.outcome.estimatedCost - b.outcome.estimatedCost;
      break;
    case "duration":
      diff = a.outcome.duration - b.outcome.duration;
      break;
    default:
      diff = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
  }
  return sortOrder === "desc" ? -diff : diff;
}

/**
 * Query traces across session JSONL files.
 *
 * Scans all trace files for the specified agent (or a single session),
 * applies filters, sorts, and returns a paginated result.
 */
export async function queryTraces(
  params: TraceQueryParams & { baseDir?: string },
): Promise<TraceQueryResult> {
  const agentDir = resolveAgentDir(params.agentId, params.baseDir);
  const sortBy = params.sortBy ?? "timestamp";
  const sortOrder = params.sortOrder ?? "desc";
  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;

  let files: string[];
  if (params.sessionId) {
    const filePath = path.join(agentDir, `${params.sessionId}.jsonl`);
    files = fs.existsSync(filePath) ? [filePath] : [];
  } else {
    try {
      const entries = await fsp.readdir(agentDir, { withFileTypes: true });
      files = entries
        .filter((e) => e.isFile() && e.name.endsWith(".jsonl"))
        .map((e) => path.join(agentDir, e.name));
    } catch {
      return { traces: [], total: 0 };
    }
  }

  const matched: ReasoningTrace[] = [];
  for (const filePath of files) {
    try {
      for await (const trace of readJsonlTraces(filePath)) {
        if (matchesFilters(trace, params)) {
          matched.push(trace);
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  matched.sort((a, b) => compareTraces(a, b, sortBy, sortOrder));

  return {
    traces: matched.slice(offset, offset + limit),
    total: matched.length,
  };
}

/** Retrieve a single trace by ID (scans all files for the agent). */
export async function getTrace(
  traceId: string,
  params?: { agentId?: string; baseDir?: string },
): Promise<ReasoningTrace | null> {
  const agentDir = resolveAgentDir(params?.agentId, params?.baseDir);
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(agentDir, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    const filePath = path.join(agentDir, entry.name);
    try {
      for await (const trace of readJsonlTraces(filePath)) {
        if (trace.id === traceId) {
          return trace;
        }
      }
    } catch {
      // Skip unreadable files
    }
  }
  return null;
}

/** Retrieve all subtask traces for a given parent trace ID. */
export async function getSubtasks(
  parentTraceId: string,
  params?: { agentId?: string; baseDir?: string },
): Promise<ReasoningTrace[]> {
  const result = await queryTraces({
    subtaskOf: parentTraceId,
    agentId: params?.agentId,
    baseDir: params?.baseDir,
    sortBy: "timestamp",
    sortOrder: "asc",
    limit: 1000,
  });
  return result.traces;
}
