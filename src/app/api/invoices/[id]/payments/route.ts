import { NextResponse } from "next/server";
import { enforceDemoWriteBody } from "@/lib/demo-guard";
import { createPaymentRecord, getInvoiceById, getPaymentsForInvoice } from "@/lib/store";
import { paymentInputSchema } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const invoice = await getInvoiceById(id);
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  return NextResponse.json(await getPaymentsForInvoice(id));
}

export async function POST(request: Request, ctx: Ctx) {
  const blocked = enforceDemoWriteBody(request);
  if (blocked) return blocked;

  const { id } = await ctx.params;
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const invoice = await getInvoiceById(id);
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  if (invoice.status === "draft") {
    return NextResponse.json(
      { error: "Issue the invoice before recording payments." },
      { status: 409 },
    );
  }
  if (invoice.status === "void") {
    return NextResponse.json({ error: "Void invoices can't take payments." }, { status: 409 });
  }

  const parsed = paymentInputSchema.safeParse({ ...(body as Record<string, unknown>), invoiceId: id });
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const payment = await createPaymentRecord(parsed.data);
    return NextResponse.json(payment, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Saving the payment failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
