/**
 * Filesystem Boundary — enforces configurable read/write/deny path lists
 * for agent tool execution.
 *
 * Every filesystem-touching tool call is validated against these boundaries
 * before execution. Denied paths always win over allowed paths.
 */

import os from "node:os";
import path from "node:path";
import { isPathInside } from "./scan-paths.js";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_DENIED: readonly string[] = [
  "~/.ssh/",
  "~/.gnupg/",
  "~/.aws/",
  "~/.config/gcloud/",
  "~/.docker/",
  "~/.kube/",
  "~/.netrc",
  "~/.npmrc",
  "~/.pypirc",
];

const DEFAULT_READABLE: readonly string[] = ["~"];
const DEFAULT_WRITABLE: readonly string[] = ["~/.openclaw/"];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FilesystemBoundaryConfig = {
  readable?: string[];
  writable?: string[];
  denied?: string[];
};

export type AccessCheckResult = {
  allowed: boolean;
  reason: string;
};

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function expandHome(value: string): string {
  if (!value) return value;
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function resolvePath(p: string): string {
  return path.resolve(expandHome(p));
}

// ---------------------------------------------------------------------------
// FilesystemBoundary
// ---------------------------------------------------------------------------

export class FilesystemBoundary {
  private readable: string[];
  private writable: string[];
  private denied: string[];

  constructor(config?: FilesystemBoundaryConfig) {
    this.readable = (config?.readable ?? [...DEFAULT_READABLE]).map(resolvePath);
    this.writable = (config?.writable ?? [...DEFAULT_WRITABLE]).map(resolvePath);
    this.denied = (config?.denied ?? [...DEFAULT_DENIED]).map(resolvePath);
  }

  /**
   * Check whether access to `targetPath` is allowed for the given mode.
   *
   * Evaluation order:
   * 1. Denied paths always block (highest priority).
   * 2. For writes: path must be inside a writable directory.
   * 3. For reads: path must be inside a readable directory.
   */
  checkAccess(
    targetPath: string,
    mode: "read" | "write",
  ): AccessCheckResult {
    const resolved = resolvePath(targetPath);

    // Denied paths always win
    for (const denied of this.denied) {
      if (isPathInside(denied, resolved) || resolved === denied) {
        return {
          allowed: false,
          reason: `Path "${targetPath}" is in denied directory "${denied}".`,
        };
      }
    }

    if (mode === "write") {
      for (const writable of this.writable) {
        if (isPathInside(writable, resolved)) {
          return { allowed: true, reason: "Path is within writable boundary." };
        }
      }
      return {
        allowed: false,
        reason: `Path "${targetPath}" is outside writable boundaries.`,
      };
    }

    // mode === "read"
    for (const readable of this.readable) {
      if (isPathInside(readable, resolved)) {
        return { allowed: true, reason: "Path is within readable boundary." };
      }
    }
    return {
      allowed: false,
      reason: `Path "${targetPath}" is outside readable boundaries.`,
    };
  }
}

// ---------------------------------------------------------------------------
// Tool-to-mode mapping
// ---------------------------------------------------------------------------

const WRITE_TOOLS = new Set([
  "write",
  "edit",
  "apply_patch",
]);

const READ_TOOLS = new Set([
  "read",
  "ls",
  "find",
  "grep",
]);

/**
 * Determine the filesystem access mode for a tool. Returns null for tools
 * that don't have filesystem-specific path validation (e.g. exec, browser).
 */
export function toolFilesystemMode(
  toolName: string,
): "read" | "write" | null {
  if (WRITE_TOOLS.has(toolName)) return "write";
  if (READ_TOOLS.has(toolName)) return "read";
  return null;
}

/**
 * Extract the primary filesystem path from tool parameters.
 * Returns null if no recognizable path parameter is found.
 */
export function extractToolPath(
  toolName: string,
  params: Record<string, unknown>,
): string | null {
  // Most fs tools use "path" or "file_path"
  if (typeof params.path === "string") return params.path;
  if (typeof params.file_path === "string") return params.file_path;
  if (typeof params.filePath === "string") return params.filePath;

  // grep/find use "directory" or "pattern" target
  if (typeof params.directory === "string") return params.directory;

  // ls uses "path" (already covered) or first positional
  if (typeof params.dir === "string") return params.dir;

  return null;
}

/**
 * Validate a filesystem tool call against the boundary.
 * Returns null if the tool doesn't need filesystem validation.
 */
export function validateToolFilesystemAccess(
  toolName: string,
  params: Record<string, unknown>,
  boundary: FilesystemBoundary,
): AccessCheckResult | null {
  const mode = toolFilesystemMode(toolName);
  if (!mode) return null;

  const targetPath = extractToolPath(toolName, params);
  if (!targetPath) return null;

  return boundary.checkAccess(targetPath, mode);
}
