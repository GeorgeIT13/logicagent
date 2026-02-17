// Classifier
export {
  classifyAction,
  getClassificationMap,
  registerToolTier,
  unregisterToolTier,
} from "./classifier.js";

// Gate
export {
  AUTONOMY_POLICY,
  DEFAULT_CONFIDENCE_THRESHOLD,
  evaluateGate,
  isValidAutonomyLevel,
  parseAutonomyLevel,
} from "./gate.js";

// Approval pipeline
export { AutonomyApprovalManager, DEFAULT_AUTONOMY_APPROVAL_TIMEOUT_MS } from "./approval-manager.js";
export {
  getGlobalAutonomyApprovalManager,
  initializeGlobalAutonomyApprovalManager,
  resetGlobalAutonomyApprovalManager,
} from "./approval-manager-global.js";
export {
  addAutoApproveRule,
  checkAutoApproveRule,
  listAutoApproveRules,
  loadAutoApproveRules,
  matchesToolPattern,
  removeAutoApproveRule,
  saveAutoApproveRules,
} from "./auto-approve-rules.js";
export { createAutonomyApprovalForwarder } from "./approval-forwarder.js";

// Core types
export type {
  ActionTier,
  AutonomyLevel,
  AutonomyPolicy,
  GateDecision,
  GateEvaluation,
  ToolAutonomyHint,
} from "./types.js";

// Approval types
export type {
  AutonomyApprovalDecision,
  AutonomyApprovalRecord,
  AutonomyApprovalRequestEvent,
  AutonomyApprovalRequestPayload,
  AutonomyApprovalResolvedEvent,
  AutonomyAutoApproveFile,
  AutonomyAutoApproveRule,
} from "./approval-types.js";
