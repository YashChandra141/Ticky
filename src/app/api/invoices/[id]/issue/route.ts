import { NextResponse } from "next/server";
import { issueInvoiceRecord } from "@/lib/store";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body: unknown = await request.json().catch(() => null);
  const dates =
    body && typeof body === "object"
      ? {
          issueDate:
            typeof (body as { issueDate?: unknown }).issueDate === "string"
              ? (body as { issueDate: string }).issueDate
              : undefined,
          dueDate:
            typeof (body as { dueDate?: unknown }).dueDate === "string"
              ? (body as { dueDate: string }).dueDate
              : undefined,
        }
      : {};

  try {
    const invoice = await issueInvoiceRecord(id, dates);
    return NextResponse.json(invoice);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Issuing failed.";
    const status = /not found/i.test(message) ? 404 : /only a draft/i.test(message) ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
