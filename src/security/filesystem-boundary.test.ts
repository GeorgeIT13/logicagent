import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractToolPath,
  FilesystemBoundary,
  toolFilesystemMode,
  validateToolFilesystemAccess,
} from "./filesystem-boundary.js";

const HOME = os.homedir();

describe("FilesystemBoundary", () => {
  describe("default config", () => {
    const boundary = new FilesystemBoundary();

    it("allows reading files under home", () => {
      const result = boundary.checkAccess(path.join(HOME, "projects/foo.ts"), "read");
      expect(result.allowed).toBe(true);
    });

    it("denies reading .ssh directory", () => {
      const result = boundary.checkAccess(path.join(HOME, ".ssh/id_rsa"), "read");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("denied");
    });

    it("denies reading .aws directory", () => {
      const result = boundary.checkAccess(path.join(HOME, ".aws/credentials"), "read");
      expect(result.allowed).toBe(false);
    });

    it("denies reading .gnupg directory", () => {
      const result = boundary.checkAccess(path.join(HOME, ".gnupg/secring.gpg"), "read");
      expect(result.allowed).toBe(false);
    });

    it("allows writing to .openclaw directory", () => {
      const result = boundary.checkAccess(path.join(HOME, ".openclaw/config.json"), "write");
      expect(result.allowed).toBe(true);
    });

    it("denies writing outside writable boundaries", () => {
      const result = boundary.checkAccess(path.join(HOME, "projects/foo.ts"), "write");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("outside writable");
    });

    it("denies reading files outside home", () => {
      const result = boundary.checkAccess("/etc/passwd", "read");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("outside readable");
    });
  });

  describe("custom config", () => {
    it("respects custom readable paths", () => {
      const boundary = new FilesystemBoundary({
        readable: ["/opt/data"],
        writable: [],
        denied: [],
      });
      expect(boundary.checkAccess("/opt/data/file.txt", "read").allowed).toBe(true);
      expect(boundary.checkAccess("/etc/passwd", "read").allowed).toBe(false);
    });

    it("respects custom writable paths", () => {
      const boundary = new FilesystemBoundary({
        readable: ["~"],
        writable: ["~/projects"],
        denied: [],
      });
      expect(boundary.checkAccess(path.join(HOME, "projects/foo.ts"), "write").allowed).toBe(true);
      expect(boundary.checkAccess(path.join(HOME, "other/bar.ts"), "write").allowed).toBe(false);
    });

    it("denied always overrides readable and writable", () => {
      const boundary = new FilesystemBoundary({
        readable: ["~"],
        writable: ["~"],
        denied: ["~/secret"],
      });
      expect(boundary.checkAccess(path.join(HOME, "secret/key"), "read").allowed).toBe(false);
      expect(boundary.checkAccess(path.join(HOME, "secret/key"), "write").allowed).toBe(false);
    });
  });

  describe("tilde expansion", () => {
    it("expands ~ to home directory", () => {
      const boundary = new FilesystemBoundary({
        readable: ["~"],
        writable: [],
        denied: [],
      });
      expect(boundary.checkAccess("~/test.txt", "read").allowed).toBe(true);
    });
  });
});

describe("toolFilesystemMode", () => {
  it("classifies write tools", () => {
    expect(toolFilesystemMode("write")).toBe("write");
    expect(toolFilesystemMode("edit")).toBe("write");
    expect(toolFilesystemMode("apply_patch")).toBe("write");
  });

  it("classifies read tools", () => {
    expect(toolFilesystemMode("read")).toBe("read");
    expect(toolFilesystemMode("ls")).toBe("read");
    expect(toolFilesystemMode("find")).toBe("read");
    expect(toolFilesystemMode("grep")).toBe("read");
  });

  it("returns null for non-fs tools", () => {
    expect(toolFilesystemMode("web_search")).toBeNull();
    expect(toolFilesystemMode("message")).toBeNull();
    expect(toolFilesystemMode("exec")).toBeNull();
  });
});

describe("extractToolPath", () => {
  it("extracts path param", () => {
    expect(extractToolPath("read", { path: "/tmp/foo" })).toBe("/tmp/foo");
  });

  it("extracts file_path param", () => {
    expect(extractToolPath("write", { file_path: "/tmp/bar" })).toBe("/tmp/bar");
  });

  it("extracts directory param", () => {
    expect(extractToolPath("find", { directory: "/tmp" })).toBe("/tmp");
  });

  it("returns null when no path found", () => {
    expect(extractToolPath("read", { content: "hello" })).toBeNull();
  });
});

describe("validateToolFilesystemAccess", () => {
  const boundary = new FilesystemBoundary({
    readable: ["~"],
    writable: ["~/.openclaw/"],
    denied: ["~/.ssh/"],
  });

  it("blocks writes to denied paths", () => {
    const result = validateToolFilesystemAccess(
      "write",
      { path: path.join(HOME, ".ssh/authorized_keys") },
      boundary,
    );
    expect(result).not.toBeNull();
    expect(result!.allowed).toBe(false);
  });

  it("allows reads within readable paths", () => {
    const result = validateToolFilesystemAccess(
      "read",
      { path: path.join(HOME, "projects/foo.ts") },
      boundary,
    );
    expect(result).not.toBeNull();
    expect(result!.allowed).toBe(true);
  });

  it("returns null for non-fs tools", () => {
    const result = validateToolFilesystemAccess(
      "web_search",
      { query: "test" },
      boundary,
    );
    expect(result).toBeNull();
  });

  it("returns null when no path can be extracted", () => {
    const result = validateToolFilesystemAccess(
      "read",
      { content: "hello" },
      boundary,
    );
    expect(result).toBeNull();
  });
});
