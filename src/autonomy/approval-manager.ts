/**
 * AutonomyApprovalManager — queues tool calls that need user approval and
 * awaits their resolution (allow-once / allow-always / deny).
 *
 * Modeled directly on `ExecApprovalManager` in
 * `src/gateway/exec-approval-manager.ts`. Same create → register → resolve
 * lifecycle with timeout-based expiry.
 */

import { randomUUID } from "node:crypto";
import type {
  AutonomyApprovalDecision,
  AutonomyApprovalRecord,
  AutonomyApprovalRequestPayload,
} from "./approval-types.js";

/** Default timeout for pending approvals (2 minutes, matches exec approvals). */
export const DEFAULT_AUTONOMY_APPROVAL_TIMEOUT_MS = 120_000;

/** Grace period to keep resolved entries for late awaitDecision calls. */
const RESOLVED_ENTRY_GRACE_MS = 15_000;

type PendingEntry = {
  record: AutonomyApprovalRecord;
  resolve: (decision: AutonomyApprovalDecision | null) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  promise: Promise<AutonomyApprovalDecision | null>;
};

export class AutonomyApprovalManager {
  private pending = new Map<string, PendingEntry>();

  /**
   * Create an approval record from a request payload.
   * Does NOT register it — call `register()` to start the approval timer.
   */
  create(
    request: AutonomyApprovalRequestPayload,
    timeoutMs: number,
    id?: string | null,
  ): AutonomyApprovalRecord {
    const now = Date.now();
    const resolvedId = id && id.trim().length > 0 ? id.trim() : randomUUID();
    return {
      id: resolvedId,
      request,
      createdAtMs: now,
      expiresAtMs: now + timeoutMs,
    };
  }

  /**
   * Register an approval record and return a promise that resolves when
   * the user makes a decision (or the timeout expires).
   *
   * Idempotent: re-registering a pending record returns the existing promise.
   */
  register(
    record: AutonomyApprovalRecord,
    timeoutMs: number,
  ): Promise<AutonomyApprovalDecision | null> {
    const existing = this.pending.get(record.id);
    if (existing) {
      if (existing.record.resolvedAtMs === undefined) {
        return existing.promise;
      }
      throw new Error(
        `autonomy approval id '${record.id}' already resolved`,
      );
    }

    let resolvePromise: (decision: AutonomyApprovalDecision | null) => void;
    let rejectPromise: (err: Error) => void;
    const promise = new Promise<AutonomyApprovalDecision | null>(
      (resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
      },
    );

    const entry: PendingEntry = {
      record,
      resolve: resolvePromise!,
      reject: rejectPromise!,
      timer: null as unknown as ReturnType<typeof setTimeout>,
      promise,
    };

    entry.timer = setTimeout(() => {
      record.resolvedAtMs = Date.now();
      record.decision = undefined;
      record.resolvedBy = null;
      resolvePromise(null);
      // Keep entry briefly for in-flight awaitDecision calls
      setTimeout(() => {
        if (this.pending.get(record.id) === entry) {
          this.pending.delete(record.id);
        }
      }, RESOLVED_ENTRY_GRACE_MS);
    }, timeoutMs);

    this.pending.set(record.id, entry);
    return promise;
  }

  /**
   * Resolve a pending approval with the user's decision.
   * Returns `true` if the approval was found and resolved, `false` otherwise.
   */
  resolve(
    recordId: string,
    decision: AutonomyApprovalDecision,
    resolvedBy?: string | null,
  ): boolean {
    const pending = this.pending.get(recordId);
    if (!pending) return false;
    if (pending.record.resolvedAtMs !== undefined) return false;

    clearTimeout(pending.timer);
    pending.record.resolvedAtMs = Date.now();
    pending.record.decision = decision;
    pending.record.resolvedBy = resolvedBy ?? null;

    pending.resolve(decision);

    setTimeout(() => {
      if (this.pending.get(recordId) === pending) {
        this.pending.delete(recordId);
      }
    }, RESOLVED_ENTRY_GRACE_MS);

    return true;
  }

  /** Get the current state of an approval record (snapshot). */
  getSnapshot(recordId: string): AutonomyApprovalRecord | null {
    const entry = this.pending.get(recordId);
    return entry?.record ?? null;
  }

  /**
   * Wait for decision on an already-registered approval.
   * Returns the decision promise if pending, `null` if not found.
   */
  awaitDecision(
    recordId: string,
  ): Promise<AutonomyApprovalDecision | null> | null {
    const entry = this.pending.get(recordId);
    return entry?.promise ?? null;
  }

  /** List all currently pending approval records. */
  listPending(): AutonomyApprovalRecord[] {
    const result: AutonomyApprovalRecord[] = [];
    for (const entry of this.pending.values()) {
      if (entry.record.resolvedAtMs === undefined) {
        result.push(entry.record);
      }
    }
    return result;
  }

  /** Number of currently pending approvals. */
  get pendingCount(): number {
    let count = 0;
    for (const entry of this.pending.values()) {
      if (entry.record.resolvedAtMs === undefined) count++;
    }
    return count;
  }
}
