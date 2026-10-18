import { NextResponse } from "next/server";
import { normalizePolish, polishJsonSchema } from "@/lib/ai-shared";
import { aiErrorResponse, resolveModel } from "@/lib/ai";
import { aiAvailability } from "@/lib/demo";
import { enforceDemoAiLimit } from "@/lib/demo-guard";
import { chatJson } from "@/lib/ollama";

export async function POST(request: Request) {
  const blocked = enforceDemoAiLimit(request);
  if (blocked) return blocked;

  const availability = await aiAvailability();
  if (!availability.enabled) {
    return NextResponse.json({ error: availability.message, aiDisabled: true }, { status: 503 });
  }

  const body: unknown = await request.json().catch(() => null);
  const text =
    typeof (body as { text?: unknown } | null)?.text === "string"
      ? (body as { text: string }).text.trim()
      : "";
  if (!text) {
    return NextResponse.json({ error: "Write a draft first — then I can polish it." }, { status: 400 });
  }
  const kind = (body as { kind?: unknown } | null)?.kind === "terms" ? "terms" : "notes";
  const model = await resolveModel((body as { model?: unknown } | null)?.model);

  const system = [
    `You polish the ${kind} section of an invoice.`,
    "Rewrite the text so it is clear, professional and concise (1-3 sentences).",
    "Keep the original meaning and every concrete detail (dates, amounts, references).",
    'Return only JSON matching the schema: {"text": "..."}',
  ].join("\n");

  try {
    const raw = await chatJson<unknown>({ model, system, user: text, schema: polishJsonSchema });
    const polished = normalizePolish(raw);
    if (!polished) {
      return NextResponse.json({ error: "The model returned an empty result. Try again." }, { status: 422 });
    }
    return NextResponse.json({ text: polished, model });
  } catch (error) {
    const { status, body: errorBody } = aiErrorResponse(error);
    return NextResponse.json(errorBody, { status });
  }
}
