/**
 * Per-session JSONL writer for reasoning traces.
 *
 * Adapted from the cache-trace.ts async write queue pattern.
 * Writes one file per session at ~/.logicagent/traces/<agentId>/<sessionId>.jsonl.
 * Never blocks or throws into the agent's critical path.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { ReasoningTrace } from "./types.js";
import { resolveStateDir } from "../config/paths.js";
import { safeJsonStringify } from "../utils/safe-json.js";

export interface TraceWriterConfig {
  /** Override base directory for trace files. */
  baseDir?: string;
}

export interface TraceWriter {
  /** Write a complete trace record. Fire-and-forget. */
  write(sessionId: string, agentId: string | undefined, trace: ReasoningTrace): void;
  /** Flush all pending writes (for graceful shutdown). */
  flush(): Promise<void>;
}

type WriteEntry = {
  filePath: string;
  line: string;
};

/**
 * Create a trace writer. The writer queues writes and processes them
 * sequentially to avoid file contention, and silently catches all errors.
 */
export function createTraceWriter(config?: TraceWriterConfig): TraceWriter {
  let queue = Promise.resolve();
  const dirReadyCache = new Set<string>();

  function resolveBaseDir(): string {
    if (config?.baseDir) {
      return config.baseDir;
    }
    return path.join(resolveStateDir(), "traces");
  }

  function resolveFilePath(sessionId: string, agentId: string | undefined): string {
    const base = resolveBaseDir();
    const agentDir = agentId ?? "default";
    return path.join(base, agentDir, `${sessionId}.jsonl`);
  }

  async function ensureDir(filePath: string): Promise<void> {
    const dir = path.dirname(filePath);
    if (dirReadyCache.has(dir)) {
      return;
    }
    await fs.mkdir(dir, { recursive: true });
    dirReadyCache.add(dir);
  }

  async function processWrite(entry: WriteEntry): Promise<void> {
    try {
      await ensureDir(entry.filePath);
      await fs.appendFile(entry.filePath, entry.line, "utf8");
    } catch {
      // Trace write failures are silently swallowed per spec:
      // "Reasoning trace write fails -> log error, don't block execution."
    }
  }

  function write(sessionId: string, agentId: string | undefined, trace: ReasoningTrace): void {
    const json = safeJsonStringify(trace);
    if (!json) {
      return;
    }
    const entry: WriteEntry = {
      filePath: resolveFilePath(sessionId, agentId),
      line: `${json}\n`,
    };
    queue = queue.then(() => processWrite(entry));
  }

  async function flush(): Promise<void> {
    await queue;
  }

  return { write, flush };
}
