import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { SaveAgentResult, SaveAgentOptions } from "./types.js";

// ---------------------------------------------------------------------------
// Injectable filesystem interface – exported for deterministic tests
// ---------------------------------------------------------------------------

export interface SaveAgentFs {
  lstat: typeof fs.lstat;
  mkdir: typeof fs.mkdir;
  copyFile: typeof fs.copyFile;
  writeFile: typeof fs.writeFile;
  rename: typeof fs.rename;
  unlink: typeof fs.unlink;
  open: typeof fs.open;
  chmod: typeof fs.chmod;
}

const realFs: SaveAgentFs = {
  lstat: fs.lstat,
  mkdir: fs.mkdir,
  copyFile: fs.copyFile,
  writeFile: fs.writeFile,
  rename: fs.rename,
  unlink: fs.unlink,
  open: fs.open,
  chmod: fs.chmod,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestampSafe(now: Date): string {
  return now.toISOString().replace(/:/g, "-").replace(/\..+/, "Z");
}

async function uniqueTempPath(
  fsApi: SaveAgentFs,
  dir: string,
  baseName: string,
  suffix: string,
  mode?: number,
): Promise<string> {
  const candidate = path.join(dir, `${baseName}.${suffix}`);
  try {
    const fh = await fsApi.open(candidate, "wx", mode ?? 0o600);
    await fh.close();
    return candidate;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "EEXIST") {
      // collision – insert numeric suffix before the last dot-extension
      const dotIdx = suffix.lastIndexOf(".");
      let counter = 1;
      while (true) {
        const numberedSuffix =
          dotIdx >= 0
            ? `${suffix.slice(0, dotIdx)}.${counter}${suffix.slice(dotIdx)}`
            : `${suffix}.${counter}`;
        const numbered = path.join(dir, `${baseName}.${numberedSuffix}`);
        try {
          const fh2 = await fsApi.open(numbered, "wx", mode ?? 0o600);
          await fh2.close();
          return numbered;
        } catch (err2: unknown) {
          const code2 = (err2 as NodeJS.ErrnoException)?.code;
          if (code2 !== "EEXIST") throw err2;
        }
        counter++;
        if (counter > 1000) {
          throw new Error(
            `Exhausted collision counter for ${baseName} in ${dir}`,
          );
        }
      }
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Internal implementation (injectable fs)
// ---------------------------------------------------------------------------

export async function _saveAgentDocument(
  fsApi: SaveAgentFs,
  targetPath: string,
  content: string,
  options?: SaveAgentOptions,
): Promise<SaveAgentResult> {
  const now = options?.now ?? new Date();
  const dir = path.dirname(targetPath);
  const baseName = path.basename(targetPath);

  // 1. Create parent directories
  await fsApi.mkdir(dir, { recursive: true });

  // 2. lstat target – refuse symlinks and non-regular files
  let existingStat: Awaited<ReturnType<typeof fs.lstat>> | null = null;
  try {
    existingStat = await fsApi.lstat(targetPath);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") throw err;
  }

  if (existingStat !== null) {
    if (existingStat.isSymbolicLink()) {
      throw new Error(
        `Refusing to write to symbolic link: ${targetPath}`,
      );
    }
    if (!existingStat.isFile()) {
      throw new Error(
        `Target is not a regular file: ${targetPath}`,
      );
    }
  }

  // 3. If existing file, create an exact-byte backup
  let backupPath: string | undefined;
  if (existingStat !== null) {
    const ts = timestampSafe(now);
    const reservedBackupPath = await uniqueTempPath(
      fsApi,
      dir,
      baseName,
      `${ts}.bak`,
      0o600,
    );
    try {
      await fsApi.copyFile(targetPath, reservedBackupPath);
      // Defense-in-depth: ensure backup is 0600 on POSIX
      if (process.platform !== "win32") {
        await fsApi.chmod(reservedBackupPath, 0o600);
      }
    } catch (copyErr) {
      // Best-effort cleanup of the empty reserved placeholder
      try {
        await fsApi.unlink(reservedBackupPath);
      } catch {
        // Don't mask primary copy failure; cleanup failure is secondary
      }
      throw new Error(
        `Failed to backup ${targetPath} to ${reservedBackupPath}: ${(copyErr as Error).message}`,
        { cause: copyErr },
      );
    }
    backupPath = reservedBackupPath;
  }

  // 4. Write to a unique temp file in the same directory
  const ts = timestampSafe(now);
  const tempPath = await uniqueTempPath(fsApi, dir, baseName, `${ts}.tmp`, 0o600);
  const cleanupTemp = async () => {
    try {
      await fsApi.unlink(tempPath);
    } catch {
      // best-effort
    }
  };

  try {
    await fsApi.writeFile(tempPath, content, "utf8");

    // Set restrictive permissions on POSIX
    if (process.platform !== "win32") {
      await fsApi.chmod(tempPath, 0o600);
    }

    // 5. Atomic rename temp -> target
    await fsApi.rename(tempPath, targetPath);
  } catch (err) {
    // Clean up temp on failure; original is untouched
    await cleanupTemp();
    // If backup was created, we keep it (it's a safe copy of the original)
    const context = backupPath
      ? ` while backing up to ${backupPath}`
      : "";
    throw new Error(
      `Failed to save ${targetPath}${context}: ${(err as Error).message}`,
      { cause: err },
    );
  }

  const result: SaveAgentResult = { path: targetPath };
  if (backupPath !== undefined) {
    result.backupPath = backupPath;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function saveAgentDocument(
  targetPath: string,
  content: string,
  options?: SaveAgentOptions,
): Promise<SaveAgentResult> {
  return _saveAgentDocument(realFs, targetPath, content, options);
}