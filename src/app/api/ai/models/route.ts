import { NextResponse } from "next/server";
import { aiAvailability, isDemoMode } from "@/lib/demo";
import { listOllamaModels } from "@/lib/ollama";
import { getSettings } from "@/lib/store";

export async function GET() {
  const settings = await getSettings();
  const availability = await aiAvailability();
  try {
    const models = await listOllamaModels();
    return NextResponse.json({
      online: true,
      models,
      active: settings.aiModel,
      demo: isDemoMode(),
      aiDisabled: availability.enabled ? undefined : availability.message,
    });
  } catch {
    return NextResponse.json({
      online: false,
      models: [],
      active: settings.aiModel,
      demo: isDemoMode(),
      aiDisabled: availability.enabled ? undefined : availability.message,
    });
  }
}
