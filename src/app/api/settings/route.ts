import { NextResponse } from "next/server";
import { enforceDemoWriteBody } from "@/lib/demo-guard";
import { getSettings, saveSettings } from "@/lib/store";
import { settingsSchema } from "@/lib/types";

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json(settings);
}

export async function PUT(request: Request) {
  const blocked = enforceDemoWriteBody(request);
  if (blocked) return blocked;

  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const current = await getSettings();
  const parsed = settingsSchema.safeParse({ ...current, ...(body as Record<string, unknown>) });
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 400 });
  }

  await saveSettings(parsed.data);
  return NextResponse.json(parsed.data);
}
