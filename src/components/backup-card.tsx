"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { FolderOpen, Loader2, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBytes } from "@/lib/format";
import { getDesktop } from "@/lib/desktop";

type BackupEntry = { file: string; path: string; size: number; createdAt: string };

const subscribeNoop = () => () => {};

export function BackupCard() {
  const router = useRouter();
  const [backups, setBackups] = useState<BackupEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState<BackupEntry | null>(null);
  // Desktop detection is a browser-only value: null during SSR/hydration,
  // the real bridge after mount — useSyncExternalStore handles that split.
  const desktop = useSyncExternalStore(
    subscribeNoop,
    () => getDesktop(),
    () => null,
  );

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/backup", { cache: "no-store" });
      setBackups((await response.json()) as BackupEntry[]);
    } catch {
      setBackups([]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadBackups = async () => {
      try {
        const response = await fetch("/api/backup", { cache: "no-store" });
        const data = (await response.json()) as BackupEntry[];
        if (!cancelled) setBackups(data);
      } catch {
        if (!cancelled) setBackups([]);
      }
    };
    void loadBackups();
    return () => {
      cancelled = true;
    };
  }, []);

  async function backupNow() {
    setBusy(true);
    try {
      let result: { file?: string; error?: string };
      if (desktop) {
        result = await desktop.backupNow();
      } else {
        const response = await fetch("/api/backup", { method: "POST" });
        result = (await response.json()) as { file?: string; error?: string };
      }
      if (result.error) throw new Error(result.error);
      toast.success("Backup created.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Backup failed.");
    } finally {
      setBusy(false);
    }
  }

  async function restore(entry: BackupEntry) {
    try {
      const response = await fetch("/api/backup/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: entry.file }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Restoring failed.");
      toast.success("Backup restored — everything is back to that moment.");
      setRestoring(null);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Restoring failed.");
    }
  }

  async function restoreFromFile() {
    if (!desktop) return;
    const result = await desktop.restoreBackup();
    if (result.restored) {
      toast.success("Backup restored — everything is back to that moment.");
      router.refresh();
    } else if (result.error) {
      toast.error(result.error);
    }
  }

  return (
    <Card className="mt-6">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>Data & backup</CardTitle>
        <div className="flex gap-2">
          {desktop && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void restoreFromFile()}>
              <RotateCcw data-icon="inline-start" className="size-3.5" />
              Restore from file…
            </Button>
          )}
          <Button size="sm" className="gap-1.5" disabled={busy} onClick={() => void backupNow()}>
            {busy ? (
              <Loader2 data-icon="inline-start" className="size-3.5 animate-spin" />
            ) : (
              <Save data-icon="inline-start" className="size-3.5" />
            )}
            Back up now
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-sm text-muted-foreground">
          Your data lives in one SQLite file on this machine. A backup is a snapshot of exactly
          that file — restore it here or on another computer.
        </p>
        {backups === null ? (
          <p className="text-sm text-muted-foreground">Loading backups…</p>
        ) : backups.length === 0 ? (
          <p className="text-sm text-muted-foreground">No backups yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {backups.map((backup) => (
              <li
                key={backup.file}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <span className="min-w-0">
                  <span className="block truncate font-mono text-xs">{backup.file}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(backup.createdAt).toLocaleString()} · {formatBytes(backup.size)}
                  </span>
                </span>
                <span className="flex gap-1.5">
                  {desktop && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      title="Show in folder"
                      onClick={() => void desktop.revealFile(backup.path)}
                    >
                      <FolderOpen className="size-3.5 text-muted-foreground" />
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="xs"
                    className="gap-1"
                    onClick={() => setRestoring(backup)}
                  >
                    <RotateCcw className="size-3" />
                    Restore
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <AlertDialog open={restoring !== null} onOpenChange={(open) => !open && setRestoring(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore {restoring?.file}?</AlertDialogTitle>
            <AlertDialogDescription>
              Everything added since this backup is replaced by the snapshot. The current database
              is kept aside, so nothing is lost either way.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => restoring && void restore(restoring)}>
              Restore backup
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
