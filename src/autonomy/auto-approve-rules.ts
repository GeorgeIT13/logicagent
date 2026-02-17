/**
 * Persistent auto-approve rules for the Autonomy Gate ("Approve & Remember").
 *
 * When a user approves a tool call with "allow-always", a rule is created here.
 * On subsequent tool calls the gate checks these rules *before* evaluating the
 * policy matrix, allowing the action to bypass the approval queue.
 *
 * Rules are stored at `~/.openclaw/autonomy-rules.json` (Phase 0 rebrand will
 * update the path). File format mirrors `exec-approvals.json`.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_AGENT_ID } from "../routing/session-key.js";
import type { ActionTier } from "./types.js";
import type {
  AutonomyAutoApproveAgent,
  AutonomyAutoApproveFile,
  AutonomyAutoApproveRule,
} from "./approval-types.js";

// ---------------------------------------------------------------------------
// File path
// ---------------------------------------------------------------------------

const DEFAULT_FILE = "~/.openclaw/autonomy-rules.json";

function expandHome(value: string): string {
  if (!value) return value;
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

export function resolveAutoApproveRulesPath(): string {
  return expandHome(DEFAULT_FILE);
}

// ---------------------------------------------------------------------------
// Load / save
// ---------------------------------------------------------------------------

function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

export function loadAutoApproveRules(): AutonomyAutoApproveFile {
  const filePath = resolveAutoApproveRulesPath();
  try {
    if (!fs.existsSync(filePath)) {
      return { version: 1, agents: {} };
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as AutonomyAutoApproveFile;
    if (parsed?.version !== 1) {
      return { version: 1, agents: {} };
    }
    return parsed;
  } catch {
    return { version: 1, agents: {} };
  }
}

export function saveAutoApproveRules(file: AutonomyAutoApproveFile): void {
  const filePath = resolveAutoApproveRulesPath();
  ensureDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(file, null, 2)}\n`, {
    mode: 0o600,
  });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best-effort on platforms without chmod
  }
}

// ---------------------------------------------------------------------------
// Rule matching
// ---------------------------------------------------------------------------

/**
 * Check whether a tool name matches a rule pattern.
 *
 * Supports:
 * - Exact match: `"exec"` matches `"exec"` only
 * - Trailing glob: `"exec*"` matches `"exec"`, `"exec_bash"`, etc.
 * - Wildcard: `"*"` matches everything
 */
export function matchesToolPattern(
  pattern: string,
  toolName: string,
): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith("*")) {
    const prefix = pattern.slice(0, -1);
    return toolName.startsWith(prefix);
  }
  return pattern === toolName;
}

/**
 * Check if a persistent auto-approve rule matches the given tool call.
 * Returns the matching rule, or `null` if none match.
 */
export function checkAutoApproveRule(
  toolName: string,
  tier: ActionTier,
  agentId?: string | null,
): AutonomyAutoApproveRule | null {
  const file = loadAutoApproveRules();
  const agentKey = agentId ?? DEFAULT_AGENT_ID;

  // Check agent-specific rules, then wildcard agent rules
  const agents = [agentKey, "*"];
  for (const key of agents) {
    const agent = file.agents?.[key];
    if (!agent?.rules) continue;
    for (const rule of agent.rules) {
      if (matchesToolPattern(rule.toolPattern, toolName) && rule.tier === tier) {
        // Update usage stats (fire-and-forget, non-blocking)
        recordRuleUse(file, key, rule.id);
        return rule;
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

/**
 * Add a persistent auto-approve rule ("Approve & Remember").
 * Deduplicates: won't add a rule if one with the same pattern+tier exists.
 */
export function addAutoApproveRule(
  toolName: string,
  tier: ActionTier,
  agentId?: string | null,
): AutonomyAutoApproveRule {
  const file = loadAutoApproveRules();
  const agentKey = agentId ?? DEFAULT_AGENT_ID;
  const agents = file.agents ?? {};
  const agent: AutonomyAutoApproveAgent = agents[agentKey] ?? {};
  const rules = Array.isArray(agent.rules) ? [...agent.rules] : [];

  // Deduplicate
  const existing = rules.find(
    (r) => r.toolPattern === toolName && r.tier === tier,
  );
  if (existing) return existing;

  const rule: AutonomyAutoApproveRule = {
    id: crypto.randomUUID(),
    toolPattern: toolName,
    tier,
    createdAtMs: Date.now(),
    useCount: 0,
  };
  rules.push(rule);
  agents[agentKey] = { ...agent, rules };
  file.agents = agents;
  saveAutoApproveRules(file);
  return rule;
}

/** Remove a persistent auto-approve rule by ID. Returns true if found. */
export function removeAutoApproveRule(
  ruleId: string,
  agentId?: string | null,
): boolean {
  const file = loadAutoApproveRules();
  const agentKey = agentId ?? DEFAULT_AGENT_ID;
  const agent = file.agents?.[agentKey];
  if (!agent?.rules) return false;

  const before = agent.rules.length;
  agent.rules = agent.rules.filter((r) => r.id !== ruleId);
  if (agent.rules.length === before) return false;

  saveAutoApproveRules(file);
  return true;
}

/** List all persistent auto-approve rules for a given agent. */
export function listAutoApproveRules(
  agentId?: string | null,
): AutonomyAutoApproveRule[] {
  const file = loadAutoApproveRules();
  const agentKey = agentId ?? DEFAULT_AGENT_ID;
  const agent = file.agents?.[agentKey];
  return agent?.rules ?? [];
}

// ---------------------------------------------------------------------------
// Internal: usage tracking
// ---------------------------------------------------------------------------

function recordRuleUse(
  file: AutonomyAutoApproveFile,
  agentKey: string,
  ruleId: string,
): void {
  const agent = file.agents?.[agentKey];
  if (!agent?.rules) return;

  const rule = agent.rules.find((r) => r.id === ruleId);
  if (!rule) return;

  rule.lastUsedAtMs = Date.now();
  rule.useCount = (rule.useCount ?? 0) + 1;

  // Non-blocking write — don't block the gate on I/O
  try {
    saveAutoApproveRules(file);
  } catch {
    // best-effort
  }
}
