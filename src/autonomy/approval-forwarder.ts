/**
 * AutonomyApprovalForwarder — delivers autonomy gate approval requests to
 * messaging channels so the user can approve/deny tool calls from chat.
 *
 * Modeled on `src/infra/exec-approval-forwarder.ts`. Reuses the same
 * `deliverOutboundPayloads` delivery infrastructure and
 * `ExecApprovalForwardingConfig`-shaped config.
 */

import type { OpenClawConfig } from "../config/config.js";
import type { ExecApprovalForwardTarget } from "../config/types.approvals.js";
import type {
  AutonomyApprovalDecision,
  AutonomyApprovalRequestEvent,
  AutonomyApprovalResolvedEvent,
} from "./approval-types.js";
import { loadConfig } from "../config/config.js";
import { loadSessionStore, resolveStorePath } from "../config/sessions.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { parseAgentSessionKey } from "../routing/session-key.js";
import {
  isDeliverableMessageChannel,
  normalizeMessageChannel,
} from "../utils/message-channel.js";
import { deliverOutboundPayloads } from "../infra/outbound/deliver.js";
import { resolveSessionDeliveryTarget } from "../infra/outbound/targets.js";

const log = createSubsystemLogger("autonomy/approvals");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ForwardTarget = ExecApprovalForwardTarget & {
  source: "session" | "target";
};

type PendingApproval = {
  request: AutonomyApprovalRequestEvent;
  targets: ForwardTarget[];
  timeoutId: NodeJS.Timeout | null;
};

export type AutonomyApprovalForwarder = {
  handleRequested: (request: AutonomyApprovalRequestEvent) => Promise<void>;
  handleResolved: (resolved: AutonomyApprovalResolvedEvent) => Promise<void>;
  stop: () => void;
};

export type AutonomyApprovalForwarderDeps = {
  getConfig?: () => OpenClawConfig;
  deliver?: typeof deliverOutboundPayloads;
  nowMs?: () => number;
  resolveSessionTarget?: (params: {
    cfg: OpenClawConfig;
    request: AutonomyApprovalRequestEvent;
  }) => ExecApprovalForwardTarget | null;
};

// ---------------------------------------------------------------------------
// Message formatting
// ---------------------------------------------------------------------------

function buildRequestMessage(
  request: AutonomyApprovalRequestEvent,
  nowMs: number,
): string {
  const r = request.request;
  const lines: string[] = [
    `🛡️ Autonomy gate approval required`,
    `ID: ${request.id}`,
    `Tool: ${r.toolName}`,
    `Tier: ${r.tier}`,
    `Level: ${r.level}`,
  ];
  if (r.gateReason) {
    lines.push(`Reason: ${r.gateReason}`);
  }
  if (r.confidence !== undefined) {
    lines.push(`Confidence: ${(r.confidence * 100).toFixed(0)}%`);
  }
  if (r.paramsSummary) {
    const summary =
      r.paramsSummary.length > 200
        ? `${r.paramsSummary.slice(0, 200)}…`
        : r.paramsSummary;
    lines.push(`Params: ${summary}`);
  }
  if (r.agentId) {
    lines.push(`Agent: ${r.agentId}`);
  }
  const expiresIn = Math.max(
    0,
    Math.round((request.expiresAtMs - nowMs) / 1000),
  );
  lines.push(`Expires in: ${expiresIn}s`);
  lines.push("Reply with: /gate <id> allow-once|allow-always|deny");
  return lines.join("\n");
}

function decisionLabel(decision: AutonomyApprovalDecision): string {
  if (decision === "allow-once") return "allowed once";
  if (decision === "allow-always") return "allowed always";
  return "denied";
}

function buildResolvedMessage(
  resolved: AutonomyApprovalResolvedEvent,
): string {
  const base = `✅ Autonomy approval ${decisionLabel(resolved.decision)}.`;
  const by = resolved.resolvedBy
    ? ` Resolved by ${resolved.resolvedBy}.`
    : "";
  return `${base}${by} ID: ${resolved.id}`;
}

function buildExpiredMessage(
  request: AutonomyApprovalRequestEvent,
): string {
  return `⏱️ Autonomy approval expired. ID: ${request.id}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildTargetKey(target: ExecApprovalForwardTarget): string {
  const channel =
    normalizeMessageChannel(target.channel) ?? target.channel;
  const accountId = target.accountId ?? "";
  const threadId = target.threadId ?? "";
  return [channel, target.to, accountId, threadId].join(":");
}

function shouldForward(params: {
  enabled?: boolean;
  agentFilter?: string[];
  sessionFilter?: string[];
  request: AutonomyApprovalRequestEvent;
}): boolean {
  if (!params.enabled) return false;
  if (params.agentFilter?.length) {
    const agentId =
      params.request.request.agentId ??
      parseAgentSessionKey(params.request.request.sessionKey)?.agentId;
    if (!agentId || !params.agentFilter.includes(agentId)) return false;
  }
  if (params.sessionFilter?.length) {
    const sessionKey = params.request.request.sessionKey;
    if (!sessionKey) return false;
    const matched = params.sessionFilter.some((pattern) => {
      try {
        return (
          sessionKey.includes(pattern) ||
          new RegExp(pattern).test(sessionKey)
        );
      } catch {
        return sessionKey.includes(pattern);
      }
    });
    if (!matched) return false;
  }
  return true;
}

function defaultResolveSessionTarget(params: {
  cfg: OpenClawConfig;
  request: AutonomyApprovalRequestEvent;
}): ExecApprovalForwardTarget | null {
  const sessionKey = params.request.request.sessionKey?.trim();
  if (!sessionKey) return null;
  const parsed = parseAgentSessionKey(sessionKey);
  const agentId =
    parsed?.agentId ?? params.request.request.agentId ?? "main";
  const storePath = resolveStorePath(params.cfg.session?.store, { agentId });
  const store = loadSessionStore(storePath);
  const entry = store[sessionKey];
  if (!entry) return null;
  const target = resolveSessionDeliveryTarget({
    entry,
    requestedChannel: "last",
  });
  if (!target.channel || !target.to) return null;
  if (!isDeliverableMessageChannel(target.channel)) return null;
  return {
    channel: target.channel,
    to: target.to,
    accountId: target.accountId,
    threadId: target.threadId,
  };
}

async function deliverToTargets(params: {
  cfg: OpenClawConfig;
  targets: ForwardTarget[];
  text: string;
  deliver: typeof deliverOutboundPayloads;
  shouldSend?: () => boolean;
}): Promise<void> {
  const deliveries = params.targets.map(async (target) => {
    if (params.shouldSend && !params.shouldSend()) return;
    const channel =
      normalizeMessageChannel(target.channel) ?? target.channel;
    if (!isDeliverableMessageChannel(channel)) return;
    try {
      await params.deliver({
        cfg: params.cfg,
        channel,
        to: target.to,
        accountId: target.accountId,
        threadId: target.threadId,
        payloads: [{ text: params.text }],
      });
    } catch (err) {
      log.error(
        `autonomy approvals: failed to deliver to ${channel}:${target.to}: ${String(err)}`,
      );
    }
  });
  await Promise.allSettled(deliveries);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createAutonomyApprovalForwarder(
  deps: AutonomyApprovalForwarderDeps = {},
): AutonomyApprovalForwarder {
  const getConfig = deps.getConfig ?? loadConfig;
  const deliver = deps.deliver ?? deliverOutboundPayloads;
  const nowMs = deps.nowMs ?? Date.now;
  const resolveSessionTarget =
    deps.resolveSessionTarget ?? defaultResolveSessionTarget;
  const pending = new Map<string, PendingApproval>();

  const handleRequested = async (
    request: AutonomyApprovalRequestEvent,
  ): Promise<void> => {
    const cfg = getConfig();
    const fwdConfig = cfg.approvals?.autonomy;
    if (
      !shouldForward({
        enabled: fwdConfig?.enabled,
        agentFilter: fwdConfig?.agentFilter,
        sessionFilter: fwdConfig?.sessionFilter,
        request,
      })
    ) {
      return;
    }

    const mode = fwdConfig?.mode ?? "session";
    const targets: ForwardTarget[] = [];
    const seen = new Set<string>();

    if (mode === "session" || mode === "both") {
      const sessionTarget = resolveSessionTarget({ cfg, request });
      if (sessionTarget) {
        const key = buildTargetKey(sessionTarget);
        if (!seen.has(key)) {
          seen.add(key);
          targets.push({ ...sessionTarget, source: "session" });
        }
      }
    }

    if (mode === "targets" || mode === "both") {
      for (const target of fwdConfig?.targets ?? []) {
        const key = buildTargetKey(target);
        if (seen.has(key)) continue;
        seen.add(key);
        targets.push({ ...target, source: "target" });
      }
    }

    if (targets.length === 0) return;

    const expiresInMs = Math.max(0, request.expiresAtMs - nowMs());
    const timeoutId = setTimeout(() => {
      void (async () => {
        const entry = pending.get(request.id);
        if (!entry) return;
        pending.delete(request.id);
        const text = buildExpiredMessage(request);
        await deliverToTargets({ cfg, targets: entry.targets, text, deliver });
      })();
    }, expiresInMs);
    timeoutId.unref?.();

    const pendingEntry: PendingApproval = {
      request,
      targets,
      timeoutId,
    };
    pending.set(request.id, pendingEntry);

    if (pending.get(request.id) !== pendingEntry) return;

    const text = buildRequestMessage(request, nowMs());
    await deliverToTargets({
      cfg,
      targets,
      text,
      deliver,
      shouldSend: () => pending.get(request.id) === pendingEntry,
    });
  };

  const handleResolved = async (
    resolved: AutonomyApprovalResolvedEvent,
  ): Promise<void> => {
    const entry = pending.get(resolved.id);
    if (!entry) return;
    if (entry.timeoutId) clearTimeout(entry.timeoutId);
    pending.delete(resolved.id);

    const cfg = getConfig();
    const text = buildResolvedMessage(resolved);
    await deliverToTargets({ cfg, targets: entry.targets, text, deliver });
  };

  const stop = (): void => {
    for (const entry of pending.values()) {
      if (entry.timeoutId) clearTimeout(entry.timeoutId);
    }
    pending.clear();
  };

  return { handleRequested, handleResolved, stop };
}
