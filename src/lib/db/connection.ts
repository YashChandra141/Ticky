import { existsSync, mkdirSync, renameSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isDemoMode } from "../demo";
import { maybeSeedDemo } from "./seed-demo";
import { migrate } from "./migrations";

/**
 * One connection per process. Every repository call is synchronous, so a
 * transaction body can never be interleaved by another request — the local
 * single-user app needs nothing fancier.
 */
let handle: DatabaseSync | null = null;
let overrideDir: string | null = null;
let transactionDepth = 0;

/** Where all Ticky data lives: the SQLite file + the backups folder. */
export function dataDir(): string {
  if (overrideDir) return overrideDir;
  // Demo mode keeps visitor data in /tmp — the platform recycles it.
  if (isDemoMode()) return path.join(os.tmpdir(), "ticky-demo");
  return process.env.TICKY_DATA_DIR ?? path.join(process.cwd(), "data");
}

export function dbPath(): string {
  return path.join(dataDir(), "ticky.db");
}

/** Closes the current handle and points the store at a different directory (tests). */
export function useTestDataDir(dir: string): void {
  closeDb();
  overrideDir = dir;
}

export function closeDb(): void {
  if (handle) {
    try {
      handle.close();
    } catch {
      // already closed — nothing to do
    }
    handle = null;
  }
}

function isCorruptError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? `${error.message} ${(error as { code?: string }).code ?? ""}`
      : String(error);
  return /file is not a database|SQLITE_NOTADB|database disk image is malformed/i.test(message);
}

function openFresh(): DatabaseSync {
  const db = new DatabaseSync(dbPath());
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  return db;
}

/**
 * Opens (and migrates) the singleton connection. A corrupt database file is
 * moved aside next to itself (`.corrupt-<timestamp>`) and a fresh one is
 * created — the app keeps working and the old file stays inspectable.
 */
export function getDb(): DatabaseSync {
  if (handle) return handle;

  mkdirSync(dataDir(), { recursive: true });
  if (existsSync(dbPath())) {
    let probe: DatabaseSync | undefined;
    try {
      probe = new DatabaseSync(dbPath(), { readOnly: true });
      probe.prepare("PRAGMA user_version").get();
    } catch (error) {
      if (!isCorruptError(error)) throw error;
      const aside = `${dbPath()}.corrupt-${Date.now()}`;
      renameSync(dbPath(), aside);
      console.warn(`[ticky] database file was corrupt; moved it to ${aside} and started fresh`);
      for (const suffix of ["-wal", "-shm"]) {
        const sidecar = `${dbPath()}${suffix}`;
        if (existsSync(sidecar)) {
          try {
            renameSync(sidecar, `${aside}${suffix}`);
          } catch {
            // best effort
          }
        }
      }
    } finally {
      try {
        probe?.close();
      } catch {
        // best effort
      }
    }
  }

  handle = openFresh();
  migrate(handle);
  // Populates a fresh demo database (no-op outside demo mode).
  maybeSeedDemo(handle);
  return handle;
}

/**
 * Runs `fn` inside a transaction. Nested calls join the outer transaction
 * (single connection, synchronous bodies — no interleaving to worry about).
 */
export function transact<T>(fn: () => T): T {
  const db = getDb();
  if (transactionDepth > 0) return fn();
  db.exec("BEGIN");
  transactionDepth += 1;
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    transactionDepth -= 1;
  }
}
