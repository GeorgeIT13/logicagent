/**
 * Global singleton accessor for the AutonomyApprovalManager.
 *
 * Follows the same pattern as `src/plugins/hook-runner-global.ts`.
 * Initialized during gateway startup; consumed by the tool adapter.
 */

import { AutonomyApprovalManager } from "./approval-manager.js";

let globalManager: AutonomyApprovalManager | null = null;

/**
 * Initialize the global autonomy approval manager.
 * Called once during gateway startup.
 */
export function initializeGlobalAutonomyApprovalManager(): AutonomyApprovalManager {
  globalManager = new AutonomyApprovalManager();
  return globalManager;
}

/**
 * Get the global autonomy approval manager.
 * Returns `null` if the gateway hasn't started yet.
 */
export function getGlobalAutonomyApprovalManager(): AutonomyApprovalManager | null {
  return globalManager;
}

/**
 * Reset the global manager (for testing).
 */
export function resetGlobalAutonomyApprovalManager(): void {
  globalManager = null;
}
