import { NextResponse } from "next/server";
import { extractJsonSchema, normalizeExtract } from "@/lib/ai-shared";
import { aiErrorResponse, resolveModel } from "@/lib/ai";
import { aiAvailability } from "@/lib/demo";
import { enforceDemoAiLimit } from "@/lib/demo-guard";
import { chatJson } from "@/lib/ollama";

const MAX_TEXT_CHARS = 8000;

const SYSTEM_PROMPT = [
  "You extract invoice line items and customer details from unstructured text such as emails or messages.",
  "Rules:",
  "- Each line item needs a short description, a numeric quantity (default 1) and a numeric unitPrice (0 if not stated).",
  "- Include only the goods or services mentioned; ignore taxes, discounts and shipping unless they are actual line items.",
  "- Fill customer name, email and address only when present in the text, otherwise empty strings.",
  "- Totals are computed by the app. Never invent or include subtotal, total, tax total or balance values.",
  "- If the text is unclear, leave the matching field empty or zero — never guess a price.",
  "Return only JSON that matches the schema.",
].join("\n");

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
      ? (body as { text: string }).text.trim().slice(0, MAX_TEXT_CHARS)
      : "";
  if (!text) {
    return NextResponse.json({ error: "Paste the text to extract from." }, { status: 400 });
  }

  const model = await resolveModel((body as { model?: unknown } | null)?.model);

  try {
    const raw = await chatJson<unknown>({ model, system: SYSTEM_PROMPT, user: text, schema: extractJsonSchema });
    const extract = normalizeExtract(raw);
    if (extract.items.length === 0) {
      return NextResponse.json(
        { error: "No line items found in that text. Try including quantities and prices." },
        { status: 422 },
      );
    }
    return NextResponse.json({ ...extract, model });
  } catch (error) {
    const { status, body: errorBody } = aiErrorResponse(error);
    return NextResponse.json(errorBody, { status });
  }
}
