import { existsSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { enforceDemoWriteBody } from "@/lib/demo-guard";
import { backupsDir } from "@/lib/db/backup";
import { restoreDatabaseBackup } from "@/lib/store";

const bodySchema = z.object({
  file: z.string().min(1).max(600),
});

/**
 * Accepts either a backup file *name* from the list endpoint (resolved inside
 * the backups directory — basename() strips any path games) or an absolute
 * path, which is how the desktop restore dialog provides it.
 */
export async function POST(request: Request) {
  const blocked = enforceDemoWriteBody(request);
  if (blocked) return blocked;

  const body: unknown = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Tell me which backup to restore." }, { status: 400 });
  }

  const file = parsed.data.file;
  const resolved = path.isAbsolute(file) ? file : path.join(backupsDir(), path.basename(file));

  if (!existsSync(resolved)) {
    return NextResponse.json({ error: "That backup file doesn't exist." }, { status: 404 });
  }

  try {
    const result = await restoreDatabaseBackup(resolved);
    return NextResponse.json({ ok: true, previousDataAt: result.previousDataAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Restoring failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
