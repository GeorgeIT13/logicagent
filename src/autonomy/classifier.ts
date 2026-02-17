/**
 * Action classifier for the Autonomy Gate.
 *
 * Maps tool names (and optionally their params) to an ActionTier.
 * Tools can also self-declare their tier via ToolAutonomyHint.
 */

import type { ActionTier, ToolAutonomyHint } from "./types.js";

/**
 * Default classification registry. Maps tool names to their action tier.
 * Tools not in this map fall through to `defaultTier`.
 */
const TOOL_TIER_MAP = new Map<string, ActionTier>([
  // Read-only / no side effects → cached_pattern
  ["read", "cached_pattern"],
  ["grep", "cached_pattern"],
  ["find", "cached_pattern"],
  ["ls", "cached_pattern"],
  ["web_search", "cached_pattern"],
  ["web_fetch", "cached_pattern"],
  ["memory_search", "cached_pattern"],
  ["memory_get", "cached_pattern"],
  ["agents_list", "cached_pattern"],
  ["sessions_list", "cached_pattern"],
  ["sessions_history", "cached_pattern"],
  ["session_status", "cached_pattern"],

  // Stateless writes with bounded impact → ephemeral_compute
  ["write", "ephemeral_compute"],
  ["edit", "ephemeral_compute"],
  ["apply_patch", "ephemeral_compute"],
  ["exec", "ephemeral_compute"],
  ["bash", "ephemeral_compute"],
  ["process", "ephemeral_compute"],
  ["image", "ephemeral_compute"],
  ["tts", "ephemeral_compute"],

  // Long-running or infrastructure-level → persistent_service
  ["cron", "persistent_service"],
  ["gateway", "persistent_service"],
  ["nodes", "persistent_service"],
  ["subagents", "persistent_service"],
  ["sessions_spawn", "persistent_service"],

  // Complex multi-step environments → sandboxed_workspace
  ["browser", "sandboxed_workspace"],
  ["canvas", "sandboxed_workspace"],

  // Externally-visible / destructive → irreversible
  ["message", "irreversible"],
  ["sessions_send", "irreversible"],
  ["whatsapp_login", "irreversible"],
]);

/** Fallback tier for tools not in the registry. Conservative default. */
const DEFAULT_TIER: ActionTier = "persistent_service";

/** Runtime overrides registered by tools or plugins. */
const runtimeOverrides = new Map<string, ActionTier>();

/**
 * Register a tier override for a tool at runtime.
 * Plugins use this so their tools can declare their own classification.
 */
export function registerToolTier(toolName: string, tier: ActionTier): void {
  runtimeOverrides.set(toolName, tier);
}

/**
 * Remove a runtime override (e.g. when a plugin is unloaded).
 */
export function unregisterToolTier(toolName: string): void {
  runtimeOverrides.delete(toolName);
}

/**
 * Classify a tool call into an ActionTier.
 *
 * Priority order:
 * 1. ToolAutonomyHint (tool self-declares its tier)
 * 2. Runtime overrides (registered by plugins)
 * 3. Static TOOL_TIER_MAP
 * 4. DEFAULT_TIER fallback
 */
export function classifyAction(
  toolName: string,
  _params?: Record<string, unknown>,
  hint?: ToolAutonomyHint,
): ActionTier {
  // Tool-declared hint takes highest priority
  if (hint) {
    return hint.tier;
  }

  // Runtime override from plugins
  const runtimeTier = runtimeOverrides.get(toolName);
  if (runtimeTier) {
    return runtimeTier;
  }

  // Static classification
  const staticTier = TOOL_TIER_MAP.get(toolName);
  if (staticTier) {
    return staticTier;
  }

  // Conservative fallback for unknown tools
  return DEFAULT_TIER;
}

/**
 * Get the full classification map (for debugging / status display).
 * Returns a merged view: static defaults + runtime overrides.
 */
export function getClassificationMap(): ReadonlyMap<string, ActionTier> {
  const merged = new Map(TOOL_TIER_MAP);
  for (const [name, tier] of runtimeOverrides) {
    merged.set(name, tier);
  }
  return merged;
}
