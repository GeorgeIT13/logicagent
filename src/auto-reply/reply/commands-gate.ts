/**
 * /gate command — resolve pending autonomy gate approvals from chat.
 *
 * Usage: /gate <id> allow-once|allow-always|deny
 *
 * Mirrors the /approve command for exec approvals.
 */

import type { CommandHandler } from "./commands-types.js";
import { callGateway } from "../../gateway/call.js";
import { logVerbose } from "../../globals.js";
import {
  GATEWAY_CLIENT_MODES,
  GATEWAY_CLIENT_NAMES,
  isInternalMessageChannel,
} from "../../utils/message-channel.js";

const COMMAND = "/gate";

const DECISION_ALIASES: Record<string, "allow-once" | "allow-always" | "deny"> = {
  allow: "allow-once",
  once: "allow-once",
  "allow-once": "allow-once",
  allowonce: "allow-once",
  always: "allow-always",
  "allow-always": "allow-always",
  allowalways: "allow-always",
  remember: "allow-always",
  deny: "deny",
  reject: "deny",
  block: "deny",
};

type ParsedGateCommand =
  | { ok: true; id: string; decision: "allow-once" | "allow-always" | "deny" }
  | { ok: false; error: string };

function parseGateCommand(raw: string): ParsedGateCommand | null {
  const trimmed = raw.trim();
  if (!trimmed.toLowerCase().startsWith(COMMAND)) {
    return null;
  }
  const rest = trimmed.slice(COMMAND.length).trim();
  if (!rest) {
    return {
      ok: false,
      error: "Usage: /gate <id> allow-once|allow-always|deny",
    };
  }
  const tokens = rest.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) {
    return {
      ok: false,
      error: "Usage: /gate <id> allow-once|allow-always|deny",
    };
  }

  const first = tokens[0].toLowerCase();
  const second = tokens[1].toLowerCase();

  if (DECISION_ALIASES[first]) {
    return {
      ok: true,
      decision: DECISION_ALIASES[first],
      id: tokens.slice(1).join(" ").trim(),
    };
  }
  if (DECISION_ALIASES[second]) {
    return {
      ok: true,
      decision: DECISION_ALIASES[second],
      id: tokens[0],
    };
  }
  return {
    ok: false,
    error: "Usage: /gate <id> allow-once|allow-always|deny",
  };
}

function buildResolvedByLabel(
  params: Parameters<CommandHandler>[0],
): string {
  const channel = params.command.channel;
  const sender = params.command.senderId ?? "unknown";
  return `${channel}:${sender}`;
}

export const handleGateCommand: CommandHandler = async (
  params,
  allowTextCommands,
) => {
  if (!allowTextCommands) {
    return null;
  }
  const normalized = params.command.commandBodyNormalized;
  const parsed = parseGateCommand(normalized);
  if (!parsed) {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /gate from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }

  if (!parsed.ok) {
    return { shouldContinue: false, reply: { text: parsed.error } };
  }

  if (isInternalMessageChannel(params.command.channel)) {
    const scopes = params.ctx.GatewayClientScopes ?? [];
    const hasApprovals =
      scopes.includes("operator.approvals") ||
      scopes.includes("operator.admin");
    if (!hasApprovals) {
      logVerbose(
        "Ignoring /gate from gateway client missing operator.approvals.",
      );
      return {
        shouldContinue: false,
        reply: {
          text: "❌ /gate requires operator.approvals for gateway clients.",
        },
      };
    }
  }

  const resolvedBy = buildResolvedByLabel(params);
  try {
    await callGateway({
      method: "autonomy.approval.resolve",
      params: { id: parsed.id, decision: parsed.decision },
      clientName: GATEWAY_CLIENT_NAMES.GATEWAY_CLIENT,
      clientDisplayName: `Gate approval (${resolvedBy})`,
      mode: GATEWAY_CLIENT_MODES.BACKEND,
    });
  } catch (err) {
    return {
      shouldContinue: false,
      reply: {
        text: `❌ Failed to submit gate approval: ${String(err)}`,
      },
    };
  }

  return {
    shouldContinue: false,
    reply: {
      text: `✅ Autonomy approval ${parsed.decision} submitted for ${parsed.id}.`,
    },
  };
};
