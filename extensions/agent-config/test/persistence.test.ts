import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  saveAgentDocument,
  _saveAgentDocument,
} from "../src/persistence.js";
import type { SaveAgentFs } from "../src/persistence.js";

// --- helpers ---

function tmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "persist-test-"));
}

// --- saveAgentDocument ---

describe("saveAgentDocument", () => {
  describe("new file", () => {
    it("creates file in nested directory, creating parents", async () => {
      const dir = tmpdir();
      const target = path.join(dir, "sub", "deep", "agent.md");
      const content = "hello world";

      const result = await saveAgentDocument(target, content);

      expect(result.path).toBe(target);
      expect(result.backupPath).toBeUndefined();
      expect(fs.readFileSync(target, "utf8")).toBe(content);
    });

    it("returns correct result paths for new file", async () => {
      const dir = tmpdir();
      const target = path.join(dir, "agent.md");
      const content = "new";

      const result = await saveAgentDocument(target, content);

      expect(result).toEqual({ path: target });
      // backupPath should not be present
      expect("backupPath" in result).toBe(false);
    });
  });

  describe("replace existing regular file", () => {
    it("backups original and writes new content", async () => {
      const dir = tmpdir();
      const target = path.join(dir, "agent.md");
      const original = "original content";
      const newContent = "new content";

      // set up existing file
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(target, original, "utf8");

      const result = await saveAgentDocument(target, newContent);

      expect(result.path).toBe(target);
      expect(result.backupPath).toBeDefined();
      expect(result.backupPath).not.toBe(target);
      expect(fs.readFileSync(target, "utf8")).toBe(newContent);
      expect(fs.readFileSync(result.backupPath!, "utf8")).toBe(original);
    });

    it("backup has exact byte content of original", async () => {
      const dir = tmpdir();
      const target = path.join(dir, "agent.md");
      // binary-like content with null bytes and special chars
      const original = Buffer.from([0x00, 0x01, 0x02, 0xEF, 0xBB, 0xBF, 0xFF]);
      const newContent = "new";

      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(target, original);

      const result = await saveAgentDocument(target, newContent);

      const backupBytes = fs.readFileSync(result.backupPath!);
      expect(Buffer.compare(backupBytes, original)).toBe(0);
    });

    it("uses filesystem-safe UTC timestamp in backup filename", async () => {
      const dir = tmpdir();
      const target = path.join(dir, "agent.md");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(target, "original", "utf8");

      const result = await saveAgentDocument(target, "new");

      const backupName = path.basename(result.backupPath!);
      expect(backupName).toMatch(/^agent\.md\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.bak$/);
    });

    it("collision: appends numeric suffix when backup path exists", async () => {
      const dir = tmpdir();
      const target = path.join(dir, "agent.md");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(target, "original", "utf8");

      // Create a file that would collide with the first backup name
      const now = new Date("2025-01-15T12:30:45Z");
      const ts = now.toISOString().replace(/:/g, "-").replace(/\..+/, "Z");
      const colliding = path.join(dir, `agent.md.${ts}.bak`);
      fs.writeFileSync(colliding, "preexisting", "utf8");

      const result = await saveAgentDocument(target, "new", { now });

      const backupName = path.basename(result.backupPath!);
      // Should have a numeric suffix like .1.bak or .bak.1
      expect(backupName).toMatch(/agent\.md\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.\d+\.bak/);
      expect(fs.readFileSync(colliding, "utf8")).toBe("preexisting");
      expect(fs.readFileSync(result.backupPath!, "utf8")).toBe("original");
    });
  });

  describe("refusals", () => {
    it("refuses symlink target", async () => {
      const dir = tmpdir();
      const realFile = path.join(dir, "real.md");
      const symlink = path.join(dir, "link.md");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(realFile, "real", "utf8");
      fs.symlinkSync(realFile, symlink);

      await expect(saveAgentDocument(symlink, "content")).rejects.toThrow(
        /symbolic link|symlink/i,
      );
    });

    it("refuses directory target", async () => {
      const dir = tmpdir();
      const target = path.join(dir, "subdir");
      fs.mkdirSync(target, { recursive: true });

      await expect(saveAgentDocument(target, "content")).rejects.toThrow(
        /directory|not a regular file/i,
      );
    });

    it("refuses non-regular file (e.g., FIFO) if platform supports", async () => {
      const dir = tmpdir();
      const target = path.join(dir, "fifo");
      if (typeof (fs as any).mkfifoSync !== "function") {
        // skip test on platforms without mkfifo (macOS, Windows)
        return;
      }
      try {
        (fs as any).mkfifoSync(target, 0o644);
      } catch {
        // skip if mkfifo fails for other reasons
        return;
      }

      await expect(saveAgentDocument(target, "content")).rejects.toThrow();
    });
  });

  describe("injected failures", () => {
    it("write failure: cleans temp, preserves original", async () => {
      const dir = tmpdir();
      const target = path.join(dir, "agent.md");
      const original = "original content";
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(target, original, "utf8");

      const writeError = new Error("ENOSPC: no space left");
      const failingFs: SaveAgentFs = {
        lstat: fsPromises.lstat,
        mkdir: fsPromises.mkdir,
        copyFile: fsPromises.copyFile,
        open: fsPromises.open,
        chmod: fsPromises.chmod,
        rename: fsPromises.rename,
        unlink: fsPromises.unlink,
        writeFile: () => Promise.reject(writeError),
      };

      await expect(
        _saveAgentDocument(failingFs, target, "new"),
      ).rejects.toThrow("ENOSPC");

      // original file untouched
      expect(fs.readFileSync(target, "utf8")).toBe(original);

      // no temp file left behind (exclude .bak backups, only .tmp temps)
      const entries = fs.readdirSync(dir);
      const tempFiles = entries.filter(
        (e) =>
          e.startsWith("agent.md.") &&
          e !== path.basename(target) &&
          !e.endsWith(".bak"),
      );
      expect(tempFiles).toHaveLength(0);
    });

    it("rename failure: retains backup, original preserved, temp cleaned", async () => {
      const dir = tmpdir();
      const target = path.join(dir, "agent.md");
      const original = "original content";
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(target, original, "utf8");

      const renameError = new Error("EXDEV: cross-device link");
      const failingFs: SaveAgentFs = {
        lstat: fsPromises.lstat,
        mkdir: fsPromises.mkdir,
        copyFile: fsPromises.copyFile,
        open: fsPromises.open,
        chmod: fsPromises.chmod,
        writeFile: fsPromises.writeFile,
        unlink: fsPromises.unlink,
        rename: () => Promise.reject(renameError),
      };

      await expect(
        _saveAgentDocument(failingFs, target, "new"),
      ).rejects.toThrow("EXDEV");

      // original file untouched
      expect(fs.readFileSync(target, "utf8")).toBe(original);

      // backup file retained
      const entries = fs.readdirSync(dir);
      const backups = entries.filter(
        (e) => e.startsWith("agent.md.") && e.endsWith(".bak"),
      );
      expect(backups.length).toBeGreaterThanOrEqual(1);

      // no temp file left behind (temp files don't end with .bak)
      const temps = entries.filter(
        (e) =>
          e.startsWith("agent.md.") &&
          !e.endsWith(".bak") &&
          e !== path.basename(target),
      );
      expect(temps).toHaveLength(0);
    });

    it("backup copy failure: cleans placeholder, preserves original, throws actionable error", async () => {
      const dir = tmpdir();
      const target = path.join(dir, "agent.md");
      const original = "original content";
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(target, original, "utf8");

      const copyError = new Error("EIO: I/O error");
      const failingFs: SaveAgentFs = {
        lstat: fsPromises.lstat,
        mkdir: fsPromises.mkdir,
        open: fsPromises.open,
        chmod: fsPromises.chmod,
        writeFile: fsPromises.writeFile,
        rename: fsPromises.rename,
        unlink: fsPromises.unlink,
        copyFile: () => Promise.reject(copyError),
      };

      await expect(
        _saveAgentDocument(failingFs, target, "new"),
      ).rejects.toThrow(/Failed to backup/);

      // original untouched
      expect(fs.readFileSync(target, "utf8")).toBe(original);

      // no backup files left behind
      const entries = fs.readdirSync(dir);
      const backups = entries.filter((e) => e.endsWith(".bak"));
      expect(backups).toHaveLength(0);

      // no temp files left behind
      const temps = entries.filter((e) => e.endsWith(".tmp"));
      expect(temps).toHaveLength(0);
    });

    it("backup copy failure: error message names targetPath and backupPath, has cause", async () => {
      const dir = tmpdir();
      const target = path.join(dir, "agent.md");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(target, "original", "utf8");

      const copyError = new Error("EIO: I/O error");
      const failingFs: SaveAgentFs = {
        lstat: fsPromises.lstat,
        mkdir: fsPromises.mkdir,
        open: fsPromises.open,
        chmod: fsPromises.chmod,
        writeFile: fsPromises.writeFile,
        rename: fsPromises.rename,
        unlink: fsPromises.unlink,
        copyFile: () => Promise.reject(copyError),
      };

      let thrown: Error | null = null;
      try {
        await _saveAgentDocument(failingFs, target, "new");
      } catch (err) {
        thrown = err as Error;
      }

      expect(thrown).not.toBeNull();
      // Error message names targetPath
      expect(thrown!.message).toContain(target);
      // Error message names attempted backup path
      expect(thrown!.message).toContain(".bak");
      // Error has cause
      expect((thrown as any).cause).toBe(copyError);
    });

    it("backup copy failure: cleanup failure does not mask primary error", async () => {
      const dir = tmpdir();
      const target = path.join(dir, "agent.md");
      const original = "original content";
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(target, original, "utf8");

      const copyError = new Error("EIO: I/O error");
      const unlinkError = new Error("EBUSY: resource busy");
      const failingFs: SaveAgentFs = {
        lstat: fsPromises.lstat,
        mkdir: fsPromises.mkdir,
        open: fsPromises.open,
        chmod: fsPromises.chmod,
        writeFile: fsPromises.writeFile,
        rename: fsPromises.rename,
        unlink: () => Promise.reject(unlinkError),
        copyFile: () => Promise.reject(copyError),
      };

      let thrown: Error | null = null;
      try {
        await _saveAgentDocument(failingFs, target, "new");
      } catch (err) {
        thrown = err as Error;
      }

      expect(thrown).not.toBeNull();
      // Primary cause is copyError, not unlinkError
      expect((thrown as any).cause).toBe(copyError);
      // original untouched
      expect(fs.readFileSync(target, "utf8")).toBe(original);
    });
  });

  describe("permissions", () => {
    it("supplies mode 0o600 in open() for temp and backup reservation (POSIX)", async () => {
      if (process.platform === "win32") {
        return;
      }
      const dir = tmpdir();
      const target = path.join(dir, "agent.md");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(target, "original", "utf8");

      const openModes: number[] = [];
      const realOpen = fsPromises.open;

      const instrumentedFs: SaveAgentFs = {
        lstat: fsPromises.lstat,
        mkdir: fsPromises.mkdir,
        copyFile: fsPromises.copyFile,
        open: async (p, flags, mode?) => {
          if (mode !== undefined && mode !== null) {
            openModes.push(typeof mode === "string" ? parseInt(mode, 8) : mode);
          }
          return realOpen(p, flags, mode);
        },
        chmod: fsPromises.chmod,
        writeFile: fsPromises.writeFile,
        rename: fsPromises.rename,
        unlink: fsPromises.unlink,
      };

      await _saveAgentDocument(instrumentedFs, target, "new");

      // Two open() calls with explicit mode: one for temp, one for backup
      expect(openModes.length).toBeGreaterThanOrEqual(2);
      for (const mode of openModes) {
        expect(mode).toBe(0o600);
      }
    });

    it("final target and backup are 0600 on POSIX, even when original had different mode", async () => {
      if (process.platform === "win32") {
        return;
      }
      const dir = tmpdir();
      const target = path.join(dir, "agent.md");
      fs.mkdirSync(dir, { recursive: true });
      // Create original with permissive mode 0o644
      fs.writeFileSync(target, "original", { mode: 0o644 });

      const result = await saveAgentDocument(target, "new content");

      // Target must be 0600
      const targetMode = fs.statSync(target).mode & 0o777;
      expect(targetMode).toBe(0o600);

      // Backup must be 0600
      const backupMode = fs.statSync(result.backupPath!).mode & 0o777;
      expect(backupMode).toBe(0o600);
    });

    it("final target is 0600 on POSIX for new file (no original)", async () => {
      if (process.platform === "win32") {
        return;
      }
      const dir = tmpdir();
      const target = path.join(dir, "new-sub", "agent.md");

      await saveAgentDocument(target, "fresh content");

      const targetMode = fs.statSync(target).mode & 0o777;
      expect(targetMode).toBe(0o600);
    });

    it("failure preserves original mode and content", async () => {
      if (process.platform === "win32") {
        return;
      }
      const dir = tmpdir();
      const target = path.join(dir, "agent.md");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(target, "original", { mode: 0o644 });

      const originalMode = fs.statSync(target).mode & 0o777;

      const renameError = new Error("EXDEV: cross-device link");
      const failingFs: SaveAgentFs = {
        lstat: fsPromises.lstat,
        mkdir: fsPromises.mkdir,
        copyFile: fsPromises.copyFile,
        open: fsPromises.open,
        chmod: fsPromises.chmod,
        writeFile: fsPromises.writeFile,
        unlink: fsPromises.unlink,
        rename: () => Promise.reject(renameError),
      };

      await expect(
        _saveAgentDocument(failingFs, target, "new"),
      ).rejects.toThrow("EXDEV");

      // Original mode preserved
      const afterMode = fs.statSync(target).mode & 0o777;
      expect(afterMode).toBe(originalMode);

      // Original content preserved
      expect(fs.readFileSync(target, "utf8")).toBe("original");
    });
  });

  describe("result paths", () => {
    it("returns target path and backup path for replacement", async () => {
      const dir = tmpdir();
      const target = path.join(dir, "agent.md");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(target, "original", "utf8");

      const result = await saveAgentDocument(target, "new");

      expect(result.path).toBe(target);
      expect(result.backupPath).toBeDefined();
      expect(result.backupPath).toContain(path.basename(target));
      expect(result.backupPath).toContain(".bak");
    });

    it("backupPath is in same directory as target", async () => {
      const dir = tmpdir();
      const target = path.join(dir, "agent.md");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(target, "original", "utf8");

      const result = await saveAgentDocument(target, "new");

      expect(path.dirname(result.backupPath!)).toBe(dir);
    });
  });
});