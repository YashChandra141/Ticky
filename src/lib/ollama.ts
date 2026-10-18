const BASE_URL = (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434").replace(/\/+$/, "");

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type OllamaModelInfo = {
  name: string;
  size: number;
  family?: string;
  parameterSize?: string;
  quantization?: string;
};

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Node's fetch pools keep-alive sockets. If Ollama closes an idle pooled
 * connection between two of our calls, the next request dies with a
 * transient ECONNRESET/EPIPE even though the server is fine. One immediate
 * retry on a fresh connection turns that flake into a non-event.
 * (Timeouts and true "connection refused" are not retried.)
 */
function isTransportError(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string; message?: string } }).cause;
  const text = [
    error instanceof Error ? error.message : String(error),
    cause?.code ?? "",
    cause?.message ?? "",
  ].join(" ");
  return /fetch failed|ECONNRESET|EPIPE|ECONNABORTED/i.test(text);
}

async function fetchWithRetry(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  try {
    return await fetchWithTimeout(url, init, timeoutMs);
  } catch (error) {
    if (isTransportError(error)) return fetchWithTimeout(url, init, timeoutMs);
    throw error;
  }
}

export async function isOllamaOnline(timeoutMs = 2500): Promise<boolean> {
  try {
    const res = await fetchWithRetry(`${BASE_URL}/`, { method: "GET" }, timeoutMs);
    return res.ok;
  } catch {
    return false;
  }
}

export async function listOllamaModels(timeoutMs = 5000): Promise<OllamaModelInfo[]> {
  const res = await fetchWithRetry(`${BASE_URL}/api/tags`, { method: "GET" }, timeoutMs);
  if (!res.ok) throw new Error(`Ollama responded with HTTP ${res.status}`);
  const data = (await res.json()) as {
    models?: Array<{
      name?: string;
      size?: number;
      details?: { family?: string; parameter_size?: string; quantization_level?: string };
    }>;
  };
  return (data.models ?? [])
    .filter((model): model is { name: string; size?: number; details?: { family?: string; parameter_size?: string; quantization_level?: string } } => Boolean(model.name))
    .map((model) => ({
      name: model.name,
      size: model.size ?? 0,
      family: model.details?.family,
      parameterSize: model.details?.parameter_size,
      quantization: model.details?.quantization_level,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Chat completion that must return JSON conforming to `schema`
 * (Ollama structured output). Throws on transport/model errors.
 */
export async function chatJson<T>(options: {
  model: string;
  system: string;
  user: string;
  schema: object;
  temperature?: number;
  timeoutMs?: number;
}): Promise<T> {
  const res = await fetchWithRetry(
    `${BASE_URL}/api/chat`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: options.model,
        messages: [
          { role: "system", content: options.system },
          { role: "user", content: options.user },
        ] satisfies ChatMessage[],
        stream: false,
        format: options.schema,
        options: {
          temperature: options.temperature ?? 0.2,
          num_predict: 2048,
        },
      }),
    },
    options.timeoutMs ?? 180_000,
  );

  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(
        `Model "${options.model}" is not installed in Ollama. Pull it first: ollama pull ${options.model}`,
      );
    }
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`Ollama error (HTTP ${res.status}): ${detail || res.statusText}`);
  }

  const data = (await res.json()) as { message?: { content?: string } };
  const content = data.message?.content ?? "";
  return extractJson<T>(content);
}

function extractJson<T>(content: string): T {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // Some models still wrap JSON in prose — grab the outermost object.
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start !== -1 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as T;
    }
    throw new Error("The model did not return valid JSON. Try again or switch models.");
  }
}

export function isConnectionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|ECONNREFUSED|ENOTFOUND|ECONNRESET|EPIPE|aborted|timeout|socket/i.test(
    message,
  );
}
