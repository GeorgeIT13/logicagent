import type {
  AgentTool,
  AgentToolResult,
  AgentToolUpdateCallback,
} from "@mariozechner/pi-agent-core";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { ClientToolDefinition } from "./pi-embedded-runner/run/params.js";
import { classifyAction, evaluateGate, parseAutonomyLevel } from "../autonomy/index.js";
import { getGlobalAutonomyApprovalManager } from "../autonomy/approval-manager-global.js";
import { DEFAULT_AUTONOMY_APPROVAL_TIMEOUT_MS } from "../autonomy/approval-manager.js";
import { checkAutoApproveRule, addAutoApproveRule } from "../autonomy/auto-approve-rules.js";
import { loadConfig } from "../config/io.js";
import { logDebug, logError, logInfo } from "../logger.js";
import { getGlobalHookRunner } from "../plugins/hook-runner-global.js";
import { isPlainObject } from "../utils.js";
import {
  consumeAdjustedParamsForToolCall,
  isToolWrappedWithBeforeToolCallHook,
  runBeforeToolCallHook,
} from "./pi-tools.before-tool-call.js";
import { normalizeToolName } from "./tool-policy.js";
import { jsonResult } from "./tools/common.js";

// oxlint-disable-next-line typescript/no-explicit-any
type AnyAgentTool = AgentTool<any, unknown>;

type ToolExecuteArgsCurrent = [
  string,
  unknown,
  AgentToolUpdateCallback<unknown> | undefined,
  unknown,
  AbortSignal | undefined,
];
type ToolExecuteArgsLegacy = [
  string,
  unknown,
  AbortSignal | undefined,
  AgentToolUpdateCallback<unknown> | undefined,
  unknown,
];
type ToolExecuteArgs = ToolDefinition["execute"] extends (...args: infer P) => unknown
  ? P
  : ToolExecuteArgsCurrent;
type ToolExecuteArgsAny = ToolExecuteArgs | ToolExecuteArgsLegacy | ToolExecuteArgsCurrent;

function isAbortSignal(value: unknown): value is AbortSignal {
  return typeof value === "object" && value !== null && "aborted" in value;
}

function isLegacyToolExecuteArgs(args: ToolExecuteArgsAny): args is ToolExecuteArgsLegacy {
  const third = args[2];
  const fourth = args[3];
  return isAbortSignal(third) || typeof fourth === "function";
}

function describeToolExecutionError(err: unknown): {
  message: string;
  stack?: string;
} {
  if (err instanceof Error) {
    const message = err.message?.trim() ? err.message : String(err);
    return { message, stack: err.stack };
  }
  return { message: String(err) };
}

/** Build a truncated JSON summary of tool params for the approval record. */
function summarizeParams(params: unknown, maxLen = 500): string {
  if (params === undefined || params === null) return "";
  try {
    const json = JSON.stringify(params);
    return json.length > maxLen ? `${json.slice(0, maxLen)}…` : json;
  } catch {
    return String(params).slice(0, maxLen);
  }
}

function splitToolExecuteArgs(args: ToolExecuteArgsAny): {
  toolCallId: string;
  params: unknown;
  onUpdate: AgentToolUpdateCallback<unknown> | undefined;
  signal: AbortSignal | undefined;
} {
  if (isLegacyToolExecuteArgs(args)) {
    const [toolCallId, params, signal, onUpdate] = args;
    return {
      toolCallId,
      params,
      onUpdate,
      signal,
    };
  }
  const [toolCallId, params, onUpdate, _ctx, signal] = args;
  return {
    toolCallId,
    params,
    onUpdate,
    signal,
  };
}

export function toToolDefinitions(tools: AnyAgentTool[]): ToolDefinition[] {
  return tools.map((tool) => {
    const name = tool.name || "tool";
    const normalizedName = normalizeToolName(name);
    const beforeHookWrapped = isToolWrappedWithBeforeToolCallHook(tool);
    return {
      name,
      label: tool.label ?? name,
      description: tool.description ?? "",
      parameters: tool.parameters,
      execute: async (...args: ToolExecuteArgs): Promise<AgentToolResult<unknown>> => {
        const { toolCallId, params, onUpdate, signal } = splitToolExecuteArgs(args);
        let executeParams = params;
        try {
          if (!beforeHookWrapped) {
            const hookOutcome = await runBeforeToolCallHook({
              toolName: name,
              params,
              toolCallId,
            });
            if (hookOutcome.blocked) {
              throw new Error(hookOutcome.reason);
            }
            executeParams = hookOutcome.params;
          }

          // Autonomy Gate (Layer 1): evaluate whether this tool call is allowed
          const config = loadConfig();
          const autonomyLevel = parseAutonomyLevel(config.autonomy?.level);
          const actionTier = classifyAction(
            normalizedName,
            isPlainObject(executeParams) ? executeParams : undefined,
          );

          // Check persistent auto-approve rules before evaluating the policy matrix
          const autoApproveRule = checkAutoApproveRule(normalizedName, actionTier);
          if (autoApproveRule) {
            logDebug(
              `[autonomy-gate] Auto-approved via rule ${autoApproveRule.id}: ${normalizedName} (${actionTier})`,
            );
            // Rule matched — skip gate evaluation entirely
          } else {
            const gateResult = evaluateGate(
              autonomyLevel,
              actionTier,
              undefined,
              config.autonomy?.confidenceThreshold,
            );
            if (gateResult.decision === "denied") {
              throw new Error(`[autonomy-gate] Denied: ${gateResult.reason}`);
            }
            if (gateResult.decision === "needs_approval") {
              const approvalManager = getGlobalAutonomyApprovalManager();
              if (!approvalManager) {
                // Manager not initialized (e.g. running outside gateway context).
                // Fail open with a warning — matches pre-existing behavior.
                logInfo(
                  `[autonomy-gate] Approval needed for ${normalizedName} (${actionTier}): ${gateResult.reason} (no approval manager — proceeding)`,
                );
              } else {
                const timeoutMs =
                  config.autonomy?.approvalTimeoutMs ?? DEFAULT_AUTONOMY_APPROVAL_TIMEOUT_MS;

                // Build a truncated params summary for the approval record
                const paramsSummary = summarizeParams(executeParams);

                const record = approvalManager.create(
                  {
                    toolName: normalizedName,
                    paramsSummary,
                    tier: actionTier,
                    level: autonomyLevel,
                    gateReason: gateResult.reason,
                    confidence: gateResult.confidence,
                  },
                  timeoutMs,
                );

                logInfo(
                  `[autonomy-gate] Approval needed for ${normalizedName} (${actionTier}): ${gateResult.reason} — queued as ${record.id}`,
                );

                const decision = await approvalManager.register(record, timeoutMs);

                if (decision === "allow-once") {
                  logInfo(`[autonomy-gate] Approved (once) ${record.id}: ${normalizedName}`);
                } else if (decision === "allow-always") {
                  logInfo(
                    `[autonomy-gate] Approved (always) ${record.id}: ${normalizedName} — adding persistent rule`,
                  );
                  addAutoApproveRule(normalizedName, actionTier);
                } else {
                  // null (timeout) or "deny"
                  const reason =
                    decision === "deny"
                      ? `User denied tool call ${normalizedName}`
                      : `Approval timed out for tool call ${normalizedName}`;
                  throw new Error(`[autonomy-gate] ${reason}`);
                }
              }
            }
          }

          const result = await tool.execute(toolCallId, executeParams, signal, onUpdate);
          const afterParams = beforeHookWrapped
            ? (consumeAdjustedParamsForToolCall(toolCallId) ?? executeParams)
            : executeParams;

          // Call after_tool_call hook
          const hookRunner = getGlobalHookRunner();
          if (hookRunner?.hasHooks("after_tool_call")) {
            try {
              await hookRunner.runAfterToolCall(
                {
                  toolName: name,
                  params: isPlainObject(afterParams) ? afterParams : {},
                  result,
                },
                { toolName: name },
              );
            } catch (hookErr) {
              logDebug(
                `after_tool_call hook failed: tool=${normalizedName} error=${String(hookErr)}`,
              );
            }
          }

          return result;
        } catch (err) {
          if (signal?.aborted) {
            throw err;
          }
          const name =
            err && typeof err === "object" && "name" in err
              ? String((err as { name?: unknown }).name)
              : "";
          if (name === "AbortError") {
            throw err;
          }
          if (beforeHookWrapped) {
            consumeAdjustedParamsForToolCall(toolCallId);
          }
          const described = describeToolExecutionError(err);
          if (described.stack && described.stack !== described.message) {
            logDebug(`tools: ${normalizedName} failed stack:\n${described.stack}`);
          }
          logError(`[tools] ${normalizedName} failed: ${described.message}`);

          const errorResult = jsonResult({
            status: "error",
            tool: normalizedName,
            error: described.message,
          });

          // Call after_tool_call hook for errors too
          const hookRunner = getGlobalHookRunner();
          if (hookRunner?.hasHooks("after_tool_call")) {
            try {
              await hookRunner.runAfterToolCall(
                {
                  toolName: normalizedName,
                  params: isPlainObject(params) ? params : {},
                  error: described.message,
                },
                { toolName: normalizedName },
              );
            } catch (hookErr) {
              logDebug(
                `after_tool_call hook failed: tool=${normalizedName} error=${String(hookErr)}`,
              );
            }
          }

          return errorResult;
        }
      },
    } satisfies ToolDefinition;
  });
}

// Convert client tools (OpenResponses hosted tools) to ToolDefinition format
// These tools are intercepted to return a "pending" result instead of executing
export function toClientToolDefinitions(
  tools: ClientToolDefinition[],
  onClientToolCall?: (toolName: string, params: Record<string, unknown>) => void,
  hookContext?: { agentId?: string; sessionKey?: string },
): ToolDefinition[] {
  return tools.map((tool) => {
    const func = tool.function;
    return {
      name: func.name,
      label: func.name,
      description: func.description ?? "",
      // oxlint-disable-next-line typescript/no-explicit-any
      parameters: func.parameters as any,
      execute: async (...args: ToolExecuteArgs): Promise<AgentToolResult<unknown>> => {
        const { toolCallId, params } = splitToolExecuteArgs(args);
        const outcome = await runBeforeToolCallHook({
          toolName: func.name,
          params,
          toolCallId,
          ctx: hookContext,
        });
        if (outcome.blocked) {
          throw new Error(outcome.reason);
        }
        const adjustedParams = outcome.params;
        const paramsRecord = isPlainObject(adjustedParams) ? adjustedParams : {};
        // Notify handler that a client tool was called
        if (onClientToolCall) {
          onClientToolCall(func.name, paramsRecord);
        }
        // Return a pending result - the client will execute this tool
        return jsonResult({
          status: "pending",
          tool: func.name,
          message: "Tool execution delegated to client",
        });
      },
    } satisfies ToolDefinition;
  });
}
