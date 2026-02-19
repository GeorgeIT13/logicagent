/**
 * Autonomy Progression Tracker — proposes autonomy level upgrades based on
 * the agent's track record of approved actions.
 *
 * After each approval resolution the gate records the outcome here. When
 * enough positive outcomes accumulate, `shouldProposeUpgrade` returns a
 * proposal the UI/forwarder can surface to the user.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AutonomyLevel } from "./types.js";

// ---------------------------------------------------------------------------
// Config defaults
// ---------------------------------------------------------------------------

export const DEFAULT_MIN_APPROVALS = 50;
export const DEFAULT_MIN_APPROVAL_RATE = 0.95;
export const DEFAULT_COOLDOWN_DAYS = 7;

export type ProgressionConfig = {
  enabled?: boolean;
  minApprovals?: number;
  minApprovalRate?: number;
  cooldownDays?: number;
};

// ---------------------------------------------------------------------------
// Persisted stats
// ---------------------------------------------------------------------------

export type AgentProgressionStats = {
  totalApprovals: number;
  totalDenials: number;
  consecutiveSuccesses: number;
  lastProposalAtMs?: number;
  lastProposalLevel?: AutonomyLevel;
};

export type ProgressionFile = {
  version: 1;
  agents: Record<string, AgentProgressionStats>;
};

// ---------------------------------------------------------------------------
// Proposal result
// ---------------------------------------------------------------------------

export type ProgressionProposal = {
  propose: boolean;
  fromLevel: AutonomyLevel;
  toLevel: AutonomyLevel;
  stats: AgentProgressionStats;
  reason: string;
};

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

const DEFAULT_FILE = "~/.openclaw/autonomy-progression.json";

function expandHome(value: string): string {
  if (!value) return value;
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

export function resolveProgressionPath(): string {
  return expandHome(DEFAULT_FILE);
}

function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

export function loadProgressionFile(): ProgressionFile {
  const filePath = resolveProgressionPath();
  try {
    if (!fs.existsSync(filePath)) {
      return { version: 1, agents: {} };
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as ProgressionFile;
    if (parsed?.version !== 1) {
      return { version: 1, agents: {} };
    }
    return parsed;
  } catch {
    return { version: 1, agents: {} };
  }
}

export function saveProgressionFile(file: ProgressionFile): void {
  const filePath = resolveProgressionPath();
  ensureDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(file, null, 2)}\n`, {
    mode: 0o600,
  });
}

// ---------------------------------------------------------------------------
// Level ordering
// ---------------------------------------------------------------------------

const LEVEL_ORDER: AutonomyLevel[] = ["low", "medium", "high"];

function nextLevel(current: AutonomyLevel): AutonomyLevel | null {
  const idx = LEVEL_ORDER.indexOf(current);
  if (idx < 0 || idx >= LEVEL_ORDER.length - 1) return null;
  return LEVEL_ORDER[idx + 1];
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

function getAgentStats(
  file: ProgressionFile,
  agentId: string,
): AgentProgressionStats {
  return (
    file.agents[agentId] ?? {
      totalApprovals: 0,
      totalDenials: 0,
      consecutiveSuccesses: 0,
    }
  );
}

/**
 * Record an approval outcome (called after each gate resolution).
 *
 * @param approved - true if the user approved the action, false if denied.
 * @param agentId - agent that requested the action.
 */
export function recordApprovalOutcome(
  approved: boolean,
  agentId = "main",
): void {
  const file = loadProgressionFile();
  const stats = getAgentStats(file, agentId);

  if (approved) {
    stats.totalApprovals += 1;
    stats.consecutiveSuccesses += 1;
  } else {
    stats.totalDenials += 1;
    stats.consecutiveSuccesses = 0;
  }

  file.agents[agentId] = stats;
  try {
    saveProgressionFile(file);
  } catch {
    // best-effort persistence
  }
}

/**
 * Evaluate whether the agent's track record warrants a level upgrade proposal.
 */
export function shouldProposeUpgrade(
  currentLevel: AutonomyLevel,
  config?: ProgressionConfig,
  agentId = "main",
): ProgressionProposal {
  const minApprovals = config?.minApprovals ?? DEFAULT_MIN_APPROVALS;
  const minRate = config?.minApprovalRate ?? DEFAULT_MIN_APPROVAL_RATE;
  const cooldownDays = config?.cooldownDays ?? DEFAULT_COOLDOWN_DAYS;

  const file = loadProgressionFile();
  const stats = getAgentStats(file, agentId);

  const toLevel = nextLevel(currentLevel);
  const noProposal = (reason: string): ProgressionProposal => ({
    propose: false,
    fromLevel: currentLevel,
    toLevel: toLevel ?? currentLevel,
    stats,
    reason,
  });

  if (!toLevel) {
    return noProposal("Already at maximum autonomy level.");
  }

  if (config?.enabled === false) {
    return noProposal("Progression is disabled.");
  }

  const total = stats.totalApprovals + stats.totalDenials;
  if (total < minApprovals) {
    return noProposal(
      `Need at least ${minApprovals} approval decisions (currently ${total}).`,
    );
  }

  const rate = total > 0 ? stats.totalApprovals / total : 0;
  if (rate < minRate) {
    return noProposal(
      `Approval rate ${(rate * 100).toFixed(1)}% is below threshold ${(minRate * 100).toFixed(0)}%.`,
    );
  }

  if (stats.lastProposalAtMs) {
    const cooldownMs = cooldownDays * 24 * 60 * 60 * 1000;
    const elapsed = Date.now() - stats.lastProposalAtMs;
    if (elapsed < cooldownMs) {
      const daysRemaining = Math.ceil((cooldownMs - elapsed) / (24 * 60 * 60 * 1000));
      return noProposal(
        `Cooldown active — ${daysRemaining} day(s) remaining before next proposal.`,
      );
    }
  }

  return {
    propose: true,
    fromLevel: currentLevel,
    toLevel,
    stats,
    reason:
      `${stats.totalApprovals} approvals out of ${total} decisions ` +
      `(${(rate * 100).toFixed(1)}% approval rate). ` +
      `Proposing upgrade from ${currentLevel} to ${toLevel}.`,
  };
}

/**
 * Mark that a proposal was surfaced (resets cooldown timer).
 */
export function markProposalSurfaced(agentId = "main"): void {
  const file = loadProgressionFile();
  const stats = getAgentStats(file, agentId);
  stats.lastProposalAtMs = Date.now();
  file.agents[agentId] = stats;
  try {
    saveProgressionFile(file);
  } catch {
    // best-effort
  }
}

/**
 * Reset progression stats for an agent.
 */
export function resetProgressionStats(agentId = "main"): void {
  const file = loadProgressionFile();
  delete file.agents[agentId];
  try {
    saveProgressionFile(file);
  } catch {
    // best-effort
  }
}
