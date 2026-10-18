import { NextResponse } from "next/server";
import { isDemoMode } from "./demo";

/**
 * Demo-only guardrails: rate limits on the AI routes and body-size caps on
 * every writing endpoint. No-ops in the desktop app (and in local dev).
 */

const AI_REQUESTS_PER_MINUTE = 20;
const MAX_AI_BODY_BYTES = 8_000;
const MAX_WRITE_BODY_BYTES = 32_000;

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip")?.trim() || "local";
}

const hits = new Map<string, number[]>();

function takeTurn(key: string, limit: number): boolean {
  const now = Date.now();
  const windowStart = now - 60_000;
  const recent = (hits.get(key) ?? []).filter((time) => time > windowStart);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5_000) {
    // crude map hygiene; the window filter above keeps entries honest
    for (const [mapKey, times] of hits) {
      if (times.every((time) => time <= windowStart)) hits.delete(mapKey);
    }
  }
  return true;
}

/** 413/429 short-circuit response, or null when the request may proceed. */
export function enforceDemoAiLimit(request: Request): NextResponse | null {
  if (!isDemoMode()) return null;
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_AI_BODY_BYTES) {
    return NextResponse.json(
      { error: "That request is too large for the hosted demo." },
      { status: 413 },
    );
  }
  if (!takeTurn(`ai:${clientKey(request)}`, AI_REQUESTS_PER_MINUTE)) {
    return NextResponse.json(
      { error: "Demo rate limit reached — try again in a minute." },
      { status: 429 },
    );
  }
  return null;
}

/** Body-size cap for writing endpoints in demo mode. */
export function enforceDemoWriteBody(request: Request): NextResponse | null {
  if (!isDemoMode()) return null;
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_WRITE_BODY_BYTES) {
    return NextResponse.json(
      { error: "That payload is too large for the hosted demo." },
      { status: 413 },
    );
  }
  return null;
}
