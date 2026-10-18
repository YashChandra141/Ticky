import { NextResponse } from "next/server";
import { enforceDemoWriteBody } from "@/lib/demo-guard";
import {
  canEditCustomer,
  canTransition,
  itemsEqual,
  buildIssuedSnapshot,
} from "@/lib/domain/status";
import {
  deleteInvoiceRecord,
  DuplicateInvoiceNumberError,
  getInvoiceById,
  updateInvoiceRecord,
} from "@/lib/store";
import { invoiceSchema } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const invoice = await getInvoiceById(id);
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  return NextResponse.json(invoice);
}

export async function PUT(request: Request, ctx: Ctx) {
  const blocked = enforceDemoWriteBody(request);
  if (blocked) return blocked;

  const { id } = await ctx.params;
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const existing = await getInvoiceById(id);
  if (!existing) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

  const nextStatus = (body as { status?: unknown }).status;
  if (typeof nextStatus === "string" && nextStatus !== existing.status) {
    if (nextStatus !== "draft" && nextStatus !== "issued" && nextStatus !== "void") {
      return NextResponse.json({ error: `Unknown status "${nextStatus}".` }, { status: 400 });
    }
    if (!canTransition(existing.status, nextStatus)) {
      return NextResponse.json(
        { error: `An invoice can't go from ${existing.status} to ${nextStatus}.` },
        { status: 409 },
      );
    }
  }

  const candidate = { ...existing, ...(body as Record<string, unknown>), id, createdAt: existing.createdAt };
  const parsed = invoiceSchema.safeParse(candidate);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 400 });
  }
  const next = parsed.data;

  // Items and the customer block are frozen once an invoice leaves draft.
  if (existing.status !== "draft") {
    if (!itemsEqual(existing.items, next.items)) {
      return NextResponse.json(
        { error: "Items are frozen once an invoice is issued. Duplicate the invoice instead." },
        { status: 409 },
      );
    }
    if (!canEditCustomer(existing.status)) {
      const changed =
        next.customer.name !== existing.customer.name ||
        next.customer.email !== existing.customer.email ||
        next.customer.address !== existing.customer.address;
      if (changed) {
        return NextResponse.json(
          { error: "Customer details are frozen once an invoice is issued." },
          { status: 409 },
        );
      }
    }
  }

  // Freeze the snapshot on the first transition to issued.
  const issuedSnapshot =
    next.issuedSnapshot ?? (next.status === "issued" ? buildIssuedSnapshot(next, new Date().toISOString()) : null);

  try {
    const updated = await updateInvoiceRecord(id, { ...next, issuedSnapshot });
    if (!updated) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof DuplicateInvoiceNumberError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : "Saving failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  // Items and payments cascade automatically via the schema.
  const deleted = await deleteInvoiceRecord(id);
  if (!deleted) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
