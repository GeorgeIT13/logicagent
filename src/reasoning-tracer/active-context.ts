/**
 * Active trace context accessor.
 *
 * Provides a simple get/set for the currently active TraceContext within
 * an agent run. The agent runner sets this before execution and clears
 * it after finalization. Tool adapters read it to record gate decisions
 * and tool outcomes without threading it through every call signature.
 */

import type { TraceContext } from "./types.js";

let activeTraceContext: TraceContext | undefined;

/** Set the active trace context for the current agent run. */
export function setActiveTraceContext(ctx: TraceContext | undefined): void {
  activeTraceContext = ctx;
}

/** Get the active trace context (may be undefined if tracing is disabled). */
export function getActiveTraceContext(): TraceContext | undefined {
  return activeTraceContext;
}
