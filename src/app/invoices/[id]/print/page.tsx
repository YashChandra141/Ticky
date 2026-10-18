import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { connection } from "next/server";
import { Button } from "@/components/ui/button";
import { PrintButton } from "@/components/print-button";
import { formatDate, formatMinorMoney } from "@/lib/format";
import { bpsToPercent, fromMilli, lineAmountMinor } from "@/lib/domain/money";
import { deriveStatus } from "@/lib/domain/status";
import { effectiveTotals } from "@/lib/totals";
import { getInvoices, getPayments, getSettings } from "@/lib/store";
import type { Invoice, Settings } from "@/lib/types";

// Fresh file reads on every visit — no prerendered shell.
export const instant = false;

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  issued: "Issued",
  partially_paid: "Partially paid",
  paid: "Paid",
  overdue: "Overdue",
  void: "Void",
};

export default async function PrintInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const [invoices, settings, payments] = await Promise.all([
    getInvoices(),
    getSettings(),
    getPayments(),
  ]);
  const invoice = invoices.find((i) => i.id === id);
  if (!invoice) notFound();

  const invoicePayments = payments.filter((payment) => payment.invoiceId === id);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 print:max-w-none print:px-0 print:py-0">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Button variant="ghost" className="gap-2" render={<Link href={`/invoices/${id}`} />}>
          <ArrowLeft data-icon="inline-start" className="size-4" />
          Back to editor
        </Button>
        <PrintButton />
      </div>
      <PrintableInvoice
        invoice={invoice}
        settings={settings}
        payments={invoicePayments.map((payment) => ({ amountMinor: payment.amountMinor }))}
      />
    </div>
  );
}

function PrintableInvoice({
  invoice,
  settings,
  payments,
}: {
  invoice: Invoice;
  settings: Settings;
  payments: ReadonlyArray<{ amountMinor: number }>;
}) {
  const totals = effectiveTotals(invoice);
  const amountPaidMinor = payments.reduce((sum, payment) => sum + payment.amountMinor, 0);
  const balanceMinor = totals.totalMinor - amountPaidMinor;
  const customer = invoice.issuedSnapshot?.customer ?? invoice.customer;
  const status = deriveStatus(
    { status: invoice.status, dueDate: invoice.dueDate, totalMinor: totals.totalMinor },
    payments,
    invoice.issueDate, // anchor relative labels to the issue date, not "today"
  );

  return (
    <article className="text-[13px] leading-relaxed">
      <header className="flex flex-wrap items-start justify-between gap-6 border-b-2 border-foreground pb-5">
        <div>
          <h1 className="text-lg font-semibold">{settings.companyName}</h1>
          {settings.companyAddress && (
            <div className="mt-1 whitespace-pre-line text-muted-foreground">{settings.companyAddress}</div>
          )}
          {settings.companyEmail && (
            <div className="text-muted-foreground">{settings.companyEmail}</div>
          )}
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold tracking-tight">Invoice</div>
          <div className="mt-1 font-mono">{invoice.number}</div>
          <div className="mt-1 text-muted-foreground">
            {formatDate(invoice.issueDate)} · due {formatDate(invoice.dueDate)}
          </div>
        </div>
      </header>

      <section className="mt-5 flex flex-wrap justify-between gap-6">
        <div>
          <h2 className="text-xs text-muted-foreground">Bill to</h2>
          <p className="mt-1 font-medium">{customer.name}</p>
          {customer.address && (
            <div className="whitespace-pre-line text-muted-foreground">{customer.address}</div>
          )}
          {customer.email && <div className="text-muted-foreground">{customer.email}</div>}
        </div>
        <table className="text-right text-[13px]">
          <tbody>
            <tr>
              <td className="pr-4 text-muted-foreground">Status</td>
              <td className="font-medium">{STATUS_LABELS[status] ?? status}</td>
            </tr>
            <tr>
              <td className="pr-4 text-muted-foreground">Issued</td>
              <td>{formatDate(invoice.issueDate)}</td>
            </tr>
            <tr>
              <td className="pr-4 text-muted-foreground">Due</td>
              <td>{formatDate(invoice.dueDate)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <table className="mt-6 w-full">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2 font-medium">Description</th>
            <th className="py-2 text-right font-medium">Qty</th>
            <th className="py-2 text-right font-medium">Unit price</th>
            <th className="py-2 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items.map((item) => (
            <tr key={item.id} className="border-b border-border/60">
              <td className="py-2.5 pr-4">{item.description}</td>
              <td className="py-2.5 text-right font-mono tabular-nums">{fromMilli(item.quantityMilli)}</td>
              <td className="py-2.5 text-right font-mono tabular-nums">
                {formatMinorMoney(item.unitPriceMinor, invoice.currency)}
              </td>
              <td className="py-2.5 text-right font-mono tabular-nums">
                {formatMinorMoney(
                  lineAmountMinor(item.quantityMilli, item.unitPriceMinor),
                  invoice.currency,
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 flex justify-end print:break-inside-avoid">
        <table className="w-64">
          <tbody className="text-right">
            <tr>
              <td className="py-1 text-left text-muted-foreground">Subtotal</td>
              <td className="font-mono tabular-nums">{formatMinorMoney(totals.subtotalMinor, invoice.currency)}</td>
            </tr>
            {totals.discountMinor > 0 && (
              <tr>
                <td className="py-1 text-left text-muted-foreground">Discount</td>
                <td className="font-mono tabular-nums">
                  -{formatMinorMoney(totals.discountMinor, invoice.currency)}
                </td>
              </tr>
            )}
            {totals.taxMinor > 0 && (
              <tr>
                <td className="py-1 text-left text-muted-foreground">
                  Tax ({bpsToPercent(invoice.taxRateBps)}%)
                </td>
                <td className="font-mono tabular-nums">{formatMinorMoney(totals.taxMinor, invoice.currency)}</td>
              </tr>
            )}
            <tr className="border-t">
              <td className="pt-2 text-left font-medium">Total</td>
              <td className="pt-2 font-mono text-base font-semibold tabular-nums">
                {formatMinorMoney(totals.totalMinor, invoice.currency)}
              </td>
            </tr>
            {amountPaidMinor > 0 && (
              <>
                <tr>
                  <td className="py-1 text-left text-muted-foreground">Paid</td>
                  <td className="font-mono tabular-nums">
                    -{formatMinorMoney(amountPaidMinor, invoice.currency)}
                  </td>
                </tr>
                <tr>
                  <td className="text-left font-medium">Balance due</td>
                  <td className="font-mono font-semibold tabular-nums">
                    {formatMinorMoney(balanceMinor, invoice.currency)}
                  </td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      {(invoice.notes || invoice.terms || settings.paymentDetails) && (
        <footer className="mt-8 space-y-4 border-t pt-4 text-muted-foreground print:break-inside-avoid">
          {invoice.notes && (
            <section>
              <h2 className="text-xs font-medium text-foreground">Notes</h2>
              <p className="whitespace-pre-line">{invoice.notes}</p>
            </section>
          )}
          {invoice.terms && (
            <section>
              <h2 className="text-xs font-medium text-foreground">Terms</h2>
              <p className="whitespace-pre-line">{invoice.terms}</p>
            </section>
          )}
          {settings.paymentDetails && (
            <section>
              <h2 className="text-xs font-medium text-foreground">Payment details</h2>
              <p className="whitespace-pre-line">{settings.paymentDetails}</p>
            </section>
          )}
        </footer>
      )}
    </article>
  );
}
