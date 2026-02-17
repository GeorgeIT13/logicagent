import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addAutoApproveRule,
  checkAutoApproveRule,
  listAutoApproveRules,
  loadAutoApproveRules,
  matchesToolPattern,
  removeAutoApproveRule,
  resolveAutoApproveRulesPath,
  saveAutoApproveRules,
} from "./auto-approve-rules.js";
import type { AutonomyAutoApproveFile } from "./approval-types.js";

// ---------------------------------------------------------------------------
// Pattern matching
// ---------------------------------------------------------------------------

describe("matchesToolPattern", () => {
  it("matches exact tool name", () => {
    expect(matchesToolPattern("exec", "exec")).toBe(true);
    expect(matchesToolPattern("exec", "exec_bash")).toBe(false);
  });

  it("matches trailing glob", () => {
    expect(matchesToolPattern("exec*", "exec")).toBe(true);
    expect(matchesToolPattern("exec*", "exec_bash")).toBe(true);
    expect(matchesToolPattern("exec*", "read")).toBe(false);
  });

  it("matches wildcard", () => {
    expect(matchesToolPattern("*", "anything")).toBe(true);
    expect(matchesToolPattern("*", "")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Load/save/CRUD — using a temp directory
// ---------------------------------------------------------------------------

describe("auto-approve rules persistence", () => {
  let tmpDir: string;
  const originalHome = process.env.HOME;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "autonomy-rules-test-"));
    // Override HOME so resolveAutoApproveRulesPath resolves under tmpDir
    process.env.HOME = tmpDir;
    // Create the .openclaw directory
    fs.mkdirSync(path.join(tmpDir, ".openclaw"), { recursive: true });
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads empty file when none exists", () => {
    const file = loadAutoApproveRules();
    expect(file.version).toBe(1);
    expect(file.agents).toEqual({});
  });

  it("round-trips save and load", () => {
    const file: AutonomyAutoApproveFile = {
      version: 1,
      agents: {
        main: {
          rules: [
            {
              id: "test-rule-1",
              toolPattern: "exec",
              tier: "ephemeral_compute",
              createdAtMs: Date.now(),
              useCount: 0,
            },
          ],
        },
      },
    };
    saveAutoApproveRules(file);
    const loaded = loadAutoApproveRules();
    expect(loaded.version).toBe(1);
    expect(loaded.agents?.main?.rules).toHaveLength(1);
    expect(loaded.agents?.main?.rules?.[0].toolPattern).toBe("exec");
  });

  it("addAutoApproveRule creates a rule and persists it", () => {
    const rule = addAutoApproveRule("exec", "ephemeral_compute");
    expect(rule.toolPattern).toBe("exec");
    expect(rule.tier).toBe("ephemeral_compute");
    expect(rule.id).toBeTruthy();

    const loaded = loadAutoApproveRules();
    expect(loaded.agents?.main?.rules).toHaveLength(1);
  });

  it("addAutoApproveRule deduplicates", () => {
    addAutoApproveRule("exec", "ephemeral_compute");
    const second = addAutoApproveRule("exec", "ephemeral_compute");
    const loaded = loadAutoApproveRules();
    expect(loaded.agents?.main?.rules).toHaveLength(1);
    expect(second.toolPattern).toBe("exec");
  });

  it("addAutoApproveRule allows different tiers", () => {
    addAutoApproveRule("exec", "ephemeral_compute");
    addAutoApproveRule("exec", "persistent_service");
    const loaded = loadAutoApproveRules();
    expect(loaded.agents?.main?.rules).toHaveLength(2);
  });

  it("removeAutoApproveRule removes a rule", () => {
    const rule = addAutoApproveRule("exec", "ephemeral_compute");
    expect(removeAutoApproveRule(rule.id)).toBe(true);
    const loaded = loadAutoApproveRules();
    expect(loaded.agents?.main?.rules).toHaveLength(0);
  });

  it("removeAutoApproveRule returns false for unknown id", () => {
    expect(removeAutoApproveRule("nonexistent")).toBe(false);
  });

  it("listAutoApproveRules returns rules for agent", () => {
    addAutoApproveRule("exec", "ephemeral_compute");
    addAutoApproveRule("write", "ephemeral_compute");
    const rules = listAutoApproveRules();
    expect(rules).toHaveLength(2);
  });

  it("listAutoApproveRules returns empty for unknown agent", () => {
    const rules = listAutoApproveRules("unknown-agent");
    expect(rules).toHaveLength(0);
  });

  it("checkAutoApproveRule finds matching rule", () => {
    addAutoApproveRule("exec", "ephemeral_compute");
    const match = checkAutoApproveRule("exec", "ephemeral_compute");
    expect(match).not.toBeNull();
    expect(match!.toolPattern).toBe("exec");
  });

  it("checkAutoApproveRule returns null when no match", () => {
    addAutoApproveRule("exec", "ephemeral_compute");
    expect(checkAutoApproveRule("read", "cached_pattern")).toBeNull();
  });

  it("checkAutoApproveRule matches glob patterns", () => {
    addAutoApproveRule("exec*", "ephemeral_compute");
    const match = checkAutoApproveRule("exec_bash", "ephemeral_compute");
    expect(match).not.toBeNull();
  });

  it("checkAutoApproveRule requires tier match", () => {
    addAutoApproveRule("exec", "ephemeral_compute");
    expect(checkAutoApproveRule("exec", "persistent_service")).toBeNull();
  });

  it("checkAutoApproveRule respects agent-specific rules", () => {
    addAutoApproveRule("exec", "ephemeral_compute", "agent-a");
    expect(checkAutoApproveRule("exec", "ephemeral_compute", "agent-a")).not.toBeNull();
    expect(checkAutoApproveRule("exec", "ephemeral_compute", "agent-b")).toBeNull();
  });
});
