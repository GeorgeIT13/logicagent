import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutonomyApprovalManager } from "./approval-manager.js";
import type { AutonomyApprovalRequestPayload } from "./approval-types.js";

function makeRequest(overrides?: Partial<AutonomyApprovalRequestPayload>): AutonomyApprovalRequestPayload {
  return {
    toolName: "exec",
    paramsSummary: '{"command":"ls"}',
    tier: "ephemeral_compute",
    level: "low",
    gateReason: "Approval required: stateless write with bounded impact exceeds low-autonomy grant.",
    confidence: 0.9,
    ...overrides,
  };
}

describe("AutonomyApprovalManager", () => {
  let manager: AutonomyApprovalManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new AutonomyApprovalManager();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("create() returns a record with the correct fields", () => {
    const record = manager.create(makeRequest(), 120_000);
    expect(record.id).toBeTruthy();
    expect(record.request.toolName).toBe("exec");
    expect(record.createdAtMs).toBeGreaterThan(0);
    expect(record.expiresAtMs).toBe(record.createdAtMs + 120_000);
  });

  it("create() uses explicit id when provided", () => {
    const record = manager.create(makeRequest(), 120_000, "custom-id");
    expect(record.id).toBe("custom-id");
  });

  it("register() + resolve() allow-once flow", async () => {
    const record = manager.create(makeRequest(), 120_000);
    const promise = manager.register(record, 120_000);

    expect(manager.pendingCount).toBe(1);

    const ok = manager.resolve(record.id, "allow-once");
    expect(ok).toBe(true);

    const decision = await promise;
    expect(decision).toBe("allow-once");
    expect(record.decision).toBe("allow-once");
    expect(record.resolvedAtMs).toBeGreaterThan(0);
  });

  it("register() + resolve() allow-always flow", async () => {
    const record = manager.create(makeRequest(), 120_000);
    const promise = manager.register(record, 120_000);

    manager.resolve(record.id, "allow-always");
    const decision = await promise;
    expect(decision).toBe("allow-always");
  });

  it("register() + resolve() deny flow", async () => {
    const record = manager.create(makeRequest(), 120_000);
    const promise = manager.register(record, 120_000);

    manager.resolve(record.id, "deny");
    const decision = await promise;
    expect(decision).toBe("deny");
  });

  it("resolve() returns false for unknown id", () => {
    expect(manager.resolve("nonexistent", "allow-once")).toBe(false);
  });

  it("resolve() returns false for double-resolve", () => {
    const record = manager.create(makeRequest(), 120_000);
    manager.register(record, 120_000);
    expect(manager.resolve(record.id, "allow-once")).toBe(true);
    expect(manager.resolve(record.id, "deny")).toBe(false);
  });

  it("timeout resolves as null", async () => {
    const record = manager.create(makeRequest(), 1000);
    const promise = manager.register(record, 1000);

    vi.advanceTimersByTime(1001);

    const decision = await promise;
    expect(decision).toBeNull();
  });

  it("getSnapshot() returns record state", () => {
    const record = manager.create(makeRequest(), 120_000);
    manager.register(record, 120_000);

    const snapshot = manager.getSnapshot(record.id);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.request.toolName).toBe("exec");
  });

  it("getSnapshot() returns null for unknown id", () => {
    expect(manager.getSnapshot("nonexistent")).toBeNull();
  });

  it("awaitDecision() returns promise for pending", async () => {
    const record = manager.create(makeRequest(), 120_000);
    manager.register(record, 120_000);

    const promise = manager.awaitDecision(record.id);
    expect(promise).not.toBeNull();

    manager.resolve(record.id, "allow-once");
    const decision = await promise!;
    expect(decision).toBe("allow-once");
  });

  it("awaitDecision() returns null for unknown id", () => {
    expect(manager.awaitDecision("nonexistent")).toBeNull();
  });

  it("listPending() returns only unresolved records", () => {
    const r1 = manager.create(makeRequest(), 120_000);
    const r2 = manager.create(makeRequest({ toolName: "write" }), 120_000);

    manager.register(r1, 120_000);
    manager.register(r2, 120_000);

    expect(manager.listPending()).toHaveLength(2);

    manager.resolve(r1.id, "allow-once");
    expect(manager.listPending()).toHaveLength(1);
    expect(manager.listPending()[0].id).toBe(r2.id);
  });

  it("pendingCount reflects current state", () => {
    expect(manager.pendingCount).toBe(0);

    const record = manager.create(makeRequest(), 120_000);
    manager.register(record, 120_000);
    expect(manager.pendingCount).toBe(1);

    manager.resolve(record.id, "deny");
    expect(manager.pendingCount).toBe(0);
  });

  it("idempotent register returns existing promise", async () => {
    const record = manager.create(makeRequest(), 120_000);
    const p1 = manager.register(record, 120_000);
    const p2 = manager.register(record, 120_000);
    expect(p1).toBe(p2);

    manager.resolve(record.id, "allow-once");
    expect(await p1).toBe("allow-once");
  });

  it("register() after resolve throws", () => {
    const record = manager.create(makeRequest(), 120_000);
    manager.register(record, 120_000);
    manager.resolve(record.id, "allow-once");

    expect(() => manager.register(record, 120_000)).toThrow("already resolved");
  });

  it("resolvedBy is recorded", () => {
    const record = manager.create(makeRequest(), 120_000);
    manager.register(record, 120_000);

    manager.resolve(record.id, "allow-once", "user@chat");
    expect(record.resolvedBy).toBe("user@chat");
  });
});
