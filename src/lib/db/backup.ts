import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { closeDb, dataDir, dbPath, getDb } from "./connection";

export type BackupInfo = {
  /** File name inside the backups directory. */
  file: string;
  /** Absolute path — safe to reveal in Explorer (local app). */
  path: string;
  size: number;
  createdAt: string;
};

export function backupsDir(): string {
  return path.join(dataDir(), "backups");
}

export function listBackups(): BackupInfo[] {
  if (!existsSync(backupsDir())) return [];
  return readdirSync(backupsDir())
    .filter((file) => file.endsWith(".db"))
    .map((file) => {
      const full = path.join(backupsDir(), file);
      const stats = statSync(full);
      return { file, path: full, size: stats.size, createdAt: new Date(stats.mtimeMs).toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Writes a standalone, fully-vacuumed copy of the database.
 * Returns the path of the new backup.
 */
export function backupNow(): string {
  mkdirSync(backupsDir(), { recursive: true });
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .replace(/\..+$/, "");
  const target = path.join(backupsDir(), `ticky-${stamp}.db`);
  // Path is generated here; quotes are escaped as belt-and-braces for exotic TICKY_DATA_DIR values.
  getDb().exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  return target;
}

function validateBackupFile(sourcePath: string): void {
  if (!existsSync(sourcePath)) throw new Error("Backup file not found.");
  let probe: DatabaseSync | undefined;
  try {
    probe = new DatabaseSync(sourcePath, { readOnly: true });
    const integrity = probe.prepare("PRAGMA integrity_check").get() as
      | { integrity_check?: string }
      | undefined;
    if (integrity?.integrity_check !== "ok") {
      throw new Error("That file is not a healthy SQLite database.");
    }
    const version = Number(
      (probe.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined)
        ?.user_version ?? 0,
    );
    if (version < 1) throw new Error("That file is not a Ticky backup (no schema).");
    const table = probe
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'invoices'")
      .get();
    if (!table) throw new Error("That file is not a Ticky backup (invoices table missing).");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/healthy SQLite|not a Ticky/.test(message)) throw error;
    throw new Error("That file could not be read as a SQLite database.");
  } finally {
    try {
      probe?.close();
    } catch {
      // best effort
    }
  }
}

/**
 * Windows throws transient EBUSY/EPERM at file swaps when a scanner or a
 * late checkpoint still holds a handle. Restore is a one-shot admin action,
 * so a bounded retry (≈2s total) is the right amount of patience.
 */
function withFileRetry(operation: () => void, label: string, attempts = 6): void {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      operation();
      return;
    } catch (error) {
      if (!/EBUSY|EPERM|EACCES/i.test(String(error))) throw error;
      lastError = error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150 * (attempt + 1));
    }
  }
  throw new Error(`${label} failed after several attempts: ${String(lastError)}`);
}

/**
 * Replaces the live database with a validated backup. The current database is
 * copied aside first (never renamed — Windows throws EBUSY at exactly the
 * wrong moments), sidecars are cleaned, and the swap is retried on transient
 * locks. Nothing is ever lost: if the swap fails midway, the aside copy is
 * put back.
 */
export function restoreBackup(sourcePath: string): { previousDataAt: string } {
  validateBackupFile(sourcePath);

  closeDb();

  const aside = `${dbPath()}.pre-restore-${Date.now()}`;

  // 1. Preserve the current database (copy, not rename — rename locks).
  withFileRetry(() => copyFileSync(dbPath(), aside), "Preserving the current database");

  // 2. Clear the live files — copy-then-delete beats rename on Windows.
  for (const suffix of ["-wal", "-shm", ""]) {
    const target = `${dbPath()}${suffix}`;
    if (!existsSync(target)) continue;
    try {
      withFileRetry(() => rmSync(target, { force: true }), "Clearing the live database");
    } catch (error) {
      if (suffix === "") {
        // The main file must go; sidecars being stubborn is survivable.
        throw error;
      }
    }
  }

  // 3. Swap in the backup — and put the aside copy back if this fails.
  try {
    withFileRetry(() => copyFileSync(sourcePath, dbPath()), "Restoring the backup");
  } catch (error) {
    try {
      withFileRetry(() => copyFileSync(aside, dbPath()), "Putting the current database back");
    } catch {
      // dbPath is missing now; the next open will start fresh with the
      // aside copy still on disk for manual recovery.
    }
    throw error;
  }

  return { previousDataAt: aside };
}
