import { NextResponse } from "next/server";
import { enforceDemoWriteBody } from "@/lib/demo-guard";
import { createCustomerRecord, getCustomers } from "@/lib/store";
import { customerInputSchema } from "@/lib/types";

export async function GET() {
  const customers = await getCustomers();
  return NextResponse.json(customers);
}

export async function POST(request: Request) {
  const blocked = enforceDemoWriteBody(request);
  if (blocked) return blocked;

  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = customerInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 400 });
  }

  const customer = await createCustomerRecord(parsed.data);
  return NextResponse.json(customer, { status: 201 });
}
