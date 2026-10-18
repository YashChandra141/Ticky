import { todayISO } from "./format";
import { isConnectionError } from "./ollama";
import { getSettings } from "./store";

export const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "gemma2:2b";

/** Requested model (from the copilot's model picker) → settings → env → fallback. */
export async function resolveModel(requested?: unknown): Promise<string> {
  if (typeof requested === "string" && requested.trim()) return requested.trim();
  try {
    const settings = await getSettings();
    if (settings.aiModel.trim()) return settings.aiModel.trim();
  } catch {
    // settings unreadable → fall through to env default
  }
  return DEFAULT_MODEL;
}

export function aiErrorResponse(error: unknown): { status: number; body: { error: string } } {
  if (isConnectionError(error)) {
    return {
      status: 503,
      body: {
        error:
          "Ollama is not reachable. Start it with `ollama serve`, make sure a model is pulled, then try again.",
      },
    };
  }
  const message = error instanceof Error ? error.message : "The AI request failed.";
  return { status: 502, body: { error: message } };
}

export function todayLine(): string {
  return todayISO();
}
