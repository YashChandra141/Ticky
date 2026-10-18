/**
 * Hosted demo mode (TICKY_MODE=demo) — the same app, deployed publicly as a
 * sandbox. The database lives in /tmp and resets with the platform; the AI
 * copilot stays off unless the owner explicitly points at their own Ollama.
 */

export function isDemoMode(): boolean {
  return process.env.TICKY_MODE === "demo";
}

export type AiAvailability =
  | { enabled: true }
  | { enabled: false; message: string };

const DEMO_AI_DISABLED_MESSAGE =
  "The AI copilot runs locally in the Ticky desktop app — this hosted demo has no Ollama server. Download Ticky to use it; nothing you type here reaches any model.";

/**
 * In demo mode the AI endpoints only work when OLLAMA_BASE_URL was set
 * deliberately (Render dashboard) and the server answers. Everywhere else
 * (the desktop app) AI is simply on.
 */
export async function aiAvailability(): Promise<AiAvailability> {
  if (!isDemoMode()) return { enabled: true };
  const explicit = (process.env.OLLAMA_BASE_URL ?? "").trim();
  if (!explicit) return { enabled: false, message: DEMO_AI_DISABLED_MESSAGE };
  const { isOllamaOnline } = await import("./ollama");
  if (!(await isOllamaOnline(2500))) {
    return {
      enabled: false,
      message: `${DEMO_AI_DISABLED_MESSAGE} (OLLAMA_BASE_URL is set but not reachable.)`,
    };
  }
  return { enabled: true };
}
