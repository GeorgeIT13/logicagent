/**
 * Per-decision cost tracker.
 *
 * Accumulates token counts and estimated costs across multiple LLM calls
 * within a single agent decision (model fallback can mean multiple calls).
 * Wraps existing usage-format utilities for consistent cost estimation.
 */

import type { OpenClawConfig } from "../config/config.js";
import type { NormalizedUsage } from "../agents/usage.js";
import { estimateUsageCost, resolveModelCostConfig } from "../utils/usage-format.js";

export interface CostSnapshot {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

/**
 * Mutable cost accumulator for a single decision.
 * Call `addUsage()` for each LLM call, then `snapshot()` to get the final totals.
 */
export interface DecisionCostTracker {
  addUsage(params: {
    usage?: NormalizedUsage | null;
    provider?: string;
    model?: string;
    config?: OpenClawConfig;
  }): void;
  snapshot(): CostSnapshot;
}

export function createDecisionCostTracker(): DecisionCostTracker {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let estimatedCostUsd = 0;

  function addUsage(params: {
    usage?: NormalizedUsage | null;
    provider?: string;
    model?: string;
    config?: OpenClawConfig;
  }): void {
    const { usage } = params;
    if (!usage) {
      return;
    }

    inputTokens += usage.input ?? 0;
    outputTokens += usage.output ?? 0;
    cacheReadTokens += usage.cacheRead ?? 0;
    cacheWriteTokens += usage.cacheWrite ?? 0;

    const costConfig = resolveModelCostConfig({
      provider: params.provider,
      model: params.model,
      config: params.config,
    });
    const cost = estimateUsageCost({ usage, cost: costConfig });
    if (cost !== undefined) {
      estimatedCostUsd += cost;
    }
  }

  function snapshot(): CostSnapshot {
    const total = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
    return {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      totalTokens: total,
      estimatedCostUsd,
    };
  }

  return { addUsage, snapshot };
}
