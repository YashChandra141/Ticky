import { NextResponse } from "next/server";
import { enforceDemoWriteBody } from "@/lib/demo-guard";
import {
  deleteCustomerRecord,
  getCustomerById,
  updateCustomerRecord,
} from "@/lib/store";
import { customerSchema } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const customer = await getCustomerById(id);
  if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  return NextResponse.json(customer);
}

export async function PUT(request: Request, ctx: Ctx) {
  const blocked = enforceDemoWriteBody(request);
  if (blocked) return blocked;

  const { id } = await ctx.params;
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const existing = await getCustomerById(id);
  if (!existing) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

  const candidate = { ...existing, ...(body as Record<string, unknown>), id, createdAt: existing.createdAt };
  const parsed = customerSchema.safeParse(candidate);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 400 });
  }

  // Draft invoices linked to this client get their customer block synced in
  // the same transaction; issued/void invoices keep their frozen snapshot.
  const updated = await updateCustomerRecord(id, {
    name: parsed.data.name,
    email: parsed.data.email,
    address: parsed.data.address,
  });
  if (!updated) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  // Invoices keep their customer snapshot; the link is nulled by the schema.
  const deleted = await deleteCustomerRecord(id);
  if (!deleted) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
