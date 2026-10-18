import { NextResponse } from "next/server";
import { getInvoices, getPayments, getSettings } from "@/lib/store";
import { renderInvoicePdf } from "@/lib/pdf";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const [invoices, settings, payments] = await Promise.all([
    getInvoices(),
    getSettings(),
    getPayments(),
  ]);
  const invoice = invoices.find((i) => i.id === id);
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

  const invoicePayments = payments
    .filter((payment) => payment.invoiceId === id)
    .map((payment) => ({ amountMinor: payment.amountMinor }));

  const bytes = await renderInvoicePdf(invoice, settings, invoicePayments);
  const safeNumber = invoice.number.replace(/[^A-Za-z0-9_-]+/g, "_");

  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${safeNumber}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
