import { NextResponse } from "next/server";
import { draftJsonSchema, missingFields, normalizeDraft, type DraftQuestions } from "@/lib/ai-shared";
import { aiErrorResponse, resolveModel, todayLine } from "@/lib/ai";
import { aiAvailability } from "@/lib/demo";
import { enforceDemoAiLimit } from "@/lib/demo-guard";
import { chatJson } from "@/lib/ollama";

/** Prompts are capped and never logged — they may contain business details. */
const MAX_PROMPT_CHARS = 2000;
const MAX_ANSWER_CHARS = 2000;

const SYSTEM_PROMPT = [
  "You turn a natural-language request into invoice data as JSON.",
  "Rules:",
  "- quantity, unitPrice and taxRate are plain numbers: no currency symbols, no thousands separators.",
  "- If tax is not mentioned, taxRate is 0.",
  "- dueInDays is the number of days until payment is due. 'net 30' means 30. If unclear, use 30.",
  "- Write short professional notes and terms only if the request supports them, otherwise empty strings.",
  "- Do not put dates, currency codes or symbols anywhere in the output.",
  "- Totals are computed by the app. Never invent or include subtotal, total, tax total or balance values.",
  "If something in the request is unclear or missing (customer, items, prices, quantities), leave the",
  "matching field empty or zero — the app asks the user; never guess a price.",
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
  const prompt =
    typeof (body as { prompt?: unknown } | null)?.prompt === "string"
      ? (body as { prompt: string }).prompt.trim().slice(0, MAX_PROMPT_CHARS)
      : "";
  if (!prompt) {
    return NextResponse.json({ error: "Describe the invoice in a sentence or two." }, { status: 400 });
  }

  const answers =
    typeof (body as { answers?: unknown } | null)?.answers === "string"
      ? (body as { answers: string }).answers.trim().slice(0, MAX_ANSWER_CHARS)
      : "";
  const priorDraft =
    answers && (body as { draft?: unknown } | null)?.draft && typeof (body as { draft: unknown }).draft === "object"
      ? (body as { draft: unknown }).draft
      : null;

  const model = await resolveModel((body as { model?: unknown } | null)?.model);
  const system = `${SYSTEM_PROMPT}\nToday's date is ${todayLine()}.`;

  const user = priorDraft
    ? [
        prompt,
        `Your previous draft JSON: ${JSON.stringify(priorDraft)}`,
        `The user answers your questions: ${answers}`,
        "Merge their answers into the complete, corrected invoice JSON.",
      ].join("\n\n")
    : prompt;

  try {
    const raw = await chatJson<unknown>({ model, system, user, schema: draftJsonSchema });
    const draft = normalizeDraft(raw);
    const questions: DraftQuestions | null = missingFields(draft);

    // Instead of silently applying a draft full of zeros, ask first.
    // The client caps clarification at one round and applies whatever remains.
    if (questions && !answers) {
      return NextResponse.json({ needsClarification: true, draft, questions, model });
    }
    return NextResponse.json({ needsClarification: false, draft: { ...draft, model }, questions });
  } catch (error) {
    const { status, body: errorBody } = aiErrorResponse(error);
    return NextResponse.json(errorBody, { status });
  }
}
