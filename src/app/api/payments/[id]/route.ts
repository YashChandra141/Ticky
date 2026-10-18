import { NextResponse } from "next/server";
import { deletePaymentRecord } from "@/lib/store";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const deleted = await deletePaymentRecord(id);
  if (!deleted) return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
