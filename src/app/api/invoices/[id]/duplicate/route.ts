import { NextResponse } from "next/server";
import { duplicateInvoiceRecord } from "@/lib/store";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const copy = await duplicateInvoiceRecord(id);
  if (!copy) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  return NextResponse.json(copy, { status: 201 });
}
