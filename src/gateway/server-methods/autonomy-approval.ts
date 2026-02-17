/**
 * Gateway server methods for the Autonomy Gate approval pipeline.
 *
 * - `autonomy.approval.resolve` — resolve a pending approval
 * - `autonomy.approval.list`    — list pending approvals
 *
 * Modeled on `exec-approval.ts`.
 */

import type { AutonomyApprovalForwarder } from "../../autonomy/approval-forwarder.js";
import type { AutonomyApprovalManager } from "../../autonomy/approval-manager.js";
import type { AutonomyApprovalDecision } from "../../autonomy/approval-types.js";
import type { GatewayRequestHandlers } from "./types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

export function createAutonomyApprovalHandlers(
  manager: AutonomyApprovalManager,
  opts?: { forwarder?: AutonomyApprovalForwarder },
): GatewayRequestHandlers {
  return {
    "autonomy.approval.resolve": async ({
      params,
      respond,
      client,
      context,
    }) => {
      const p = params as { id?: string; decision?: string };
      const id = typeof p.id === "string" ? p.id.trim() : "";
      if (!id) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "id is required"),
        );
        return;
      }
      const decision = p.decision as AutonomyApprovalDecision | undefined;
      if (
        decision !== "allow-once" &&
        decision !== "allow-always" &&
        decision !== "deny"
      ) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "decision must be allow-once, allow-always, or deny",
          ),
        );
        return;
      }

      const resolvedBy =
        client?.connect?.client?.displayName ?? client?.connect?.client?.id;
      const ok = manager.resolve(id, decision, resolvedBy ?? null);
      if (!ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "unknown approval id"),
        );
        return;
      }

      context.broadcast(
        "autonomy.approval.resolved",
        { id, decision, resolvedBy, ts: Date.now() },
        { dropIfSlow: true },
      );

      void opts?.forwarder
        ?.handleResolved({ id, decision, resolvedBy: resolvedBy ?? null, ts: Date.now() })
        .catch((err) => {
          context.logGateway?.error?.(
            `autonomy approvals: forward resolve failed: ${String(err)}`,
          );
        });

      respond(true, { ok: true }, undefined);
    },

    "autonomy.approval.list": ({ respond }) => {
      const pending = manager.listPending();
      respond(
        true,
        {
          pending: pending.map((r) => ({
            id: r.id,
            request: r.request,
            createdAtMs: r.createdAtMs,
            expiresAtMs: r.expiresAtMs,
          })),
          count: pending.length,
        },
        undefined,
      );
    },
  };
}
