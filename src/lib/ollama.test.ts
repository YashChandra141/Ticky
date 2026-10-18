import { afterEach, describe, expect, it, vi } from "vitest";
import { chatJson, isConnectionError } from "./ollama";

const chatOk = (content: string) =>
  new Response(JSON.stringify({ message: { content } }), { status: 200 });

const transportError = (code: string) => {
  const error = new TypeError("fetch failed");
  (error as unknown as { cause: { code: string; message: string } }).cause = {
    code,
    message: `${code} boom`,
  };
  return error;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chatJson", () => {
  it("parses a clean JSON response", async () => {
    const fetchMock = vi.fn(async () => chatOk('{"text":"hello"}'));
    vi.stubGlobal("fetch", fetchMock);

    const result = await chatJson<{ text: string }>({
      model: "gemma2:2b",
      system: "s",
      user: "u",
      schema: { type: "object" },
    });
    expect(result).toEqual({ text: "hello" });
  });

  it("extracts JSON from surrounding prose", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => chatOk('Sure thing! {"text":"x"} — hope that helps.')),
    );
    const result = await chatJson<{ text: string }>({
      model: "m",
      system: "s",
      user: "u",
      schema: {},
    });
    expect(result).toEqual({ text: "x" });
  });

  it("throws a clear error on non-JSON output", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => chatOk("the answer is definitely not json")));
    await expect(
      chatJson({ model: "m", system: "s", user: "u", schema: {} }),
    ).rejects.toThrow(/did not return valid JSON/i);
  });

  it("throws a clear error on an empty response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => chatOk("")));
    await expect(
      chatJson({ model: "m", system: "s", user: "u", schema: {} }),
    ).rejects.toThrow(/did not return valid JSON/i);
  });

  it("maps a 404 to an installable-model error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"error":"model not found"}', { status: 404 })),
    );
    await expect(
      chatJson({ model: "gemma2:2b", system: "s", user: "u", schema: {} }),
    ).rejects.toThrow(/not installed in Ollama. Pull it first: ollama pull gemma2:2b/i);
  });

  it("surfaces non-404 HTTP errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("server exploded", { status: 500 })));
    await expect(
      chatJson({ model: "m", system: "s", user: "u", schema: {} }),
    ).rejects.toThrow(/Ollama error \(HTTP 500\)/);
  });

  it("retries once on a stale-socket transport error and succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(transportError("ECONNRESET"))
      .mockResolvedValueOnce(chatOk('{"ok":true}'));
    vi.stubGlobal("fetch", fetchMock);

    const result = await chatJson<{ ok: boolean }>({ model: "m", system: "s", user: "u", schema: {} });
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after one failed retry", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(transportError("ECONNRESET"))
      .mockRejectedValueOnce(transportError("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      chatJson({ model: "m", system: "s", user: "u", schema: {} }),
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("isConnectionError", () => {
  it("recognizes transport failures and aborts", () => {
    expect(isConnectionError(transportError("ECONNREFUSED"))).toBe(true);
    expect(isConnectionError(new Error("The operation was aborted"))).toBe(true);
    expect(isConnectionError(new Error("fetch failed"))).toBe(true);
  });

  it("does not swallow ordinary AI errors", () => {
    expect(isConnectionError(new Error('Model "gemma2:2b" is not installed in Ollama.'))).toBe(false);
    expect(isConnectionError(new Error("Ollama error (HTTP 500): boom"))).toBe(false);
    expect(isConnectionError("some string")).toBe(false);
  });
});
