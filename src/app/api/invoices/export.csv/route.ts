import { NextResponse } from "next/server";
import { deriveStatus } from "@/lib/domain/status";
import { todayISO } from "@/lib/format";
import { computeTotals, effectiveTotalMinor } from "@/lib/totals";
import { getInvoices, getPayments } from "@/lib/store";

/** Escapes one CSV cell; quotes anything that could break the row. */
function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

const minorToDecimal = (minor: number): string => (minor / 100).toFixed(2);

export async function GET() {
  const [invoices, payments] = await Promise.all([getInvoices(), getPayments()]);
  const today = todayISO();

  const header = [
    "Invoice number",
    "Customer",
    "Status",
    "Issued",
    "Due",
    "Currency",
    "Total",
    "Paid",
    "Balance",
  ];
  const rows = invoices.map((invoice) => {
    const invoicePayments = payments.filter((payment) => payment.invoiceId === invoice.id);
    const totalMinor = effectiveTotalMinor(invoice);
    const totals = computeTotals({ ...invoice, payments: invoicePayments });
    const status = deriveStatus(
      { status: invoice.status, dueDate: invoice.dueDate, totalMinor },
      invoicePayments,
      today,
    );
    const customer = invoice.issuedSnapshot?.customer ?? invoice.customer;
    return [
      invoice.number,
      customer.name,
      status,
      invoice.status === "draft" ? "" : invoice.issueDate,
      invoice.dueDate,
      invoice.currency,
      minorToDecimal(totalMinor),
      minorToDecimal(totals.amountPaidMinor),
      minorToDecimal(totals.balanceMinor),
    ];
  });

  // UTF-8 BOM so Excel opens it without mangling accents.
  const csv =
    "\uFEFF" +
    [header, ...rows].map((row) => row.map((cell) => csvCell(String(cell))).join(",")).join("\r\n") +
    "\r\n";

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="invoices.csv"',
      "Cache-Control": "no-store",
    },
  });
}
