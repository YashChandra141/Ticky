import { NextResponse } from "next/server";
import { enforceDemoWriteBody } from "@/lib/demo-guard";
import { createInvoiceRecord, DuplicateInvoiceNumberError, getInvoices } from "@/lib/store";
import { invoiceInputSchema } from "@/lib/types";

export async function GET() {
  const invoices = await getInvoices();
  return NextResponse.json(invoices);
}

export async function POST(request: Request) {
  const blocked = enforceDemoWriteBody(request);
  if (blocked) return blocked;

  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = invoiceInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    // Number generation + sequence bump happen inside the same transaction.
    const invoice = await createInvoiceRecord(parsed.data);
    return NextResponse.json(invoice, { status: 201 });
  } catch (error) {
    if (error instanceof DuplicateInvoiceNumberError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : "Saving failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
