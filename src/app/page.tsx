import Link from "next/link";
import { Plus } from "lucide-react";
import { connection } from "next/server";
import { Button } from "@/components/ui/button";
import { ExportCsvButton } from "@/components/export-csv-button";
import { FirstRunSetup } from "@/components/first-run-setup";
import { InvoiceTable } from "@/components/invoice-table";
import { formatMinorMoney, todayISO } from "@/lib/format";
import { computeTotals, effectiveTotalMinor } from "@/lib/totals";
import { deriveStatus, type DerivedStatus } from "@/lib/domain/status";
import { getInvoices, getPayments, getSettings } from "@/lib/store";

// Local-first app: invoices live in files on disk, so every visit renders
// from a fresh read. This opts the route out of the prerendered shell.
export const instant = false;

export default async function DashboardPage() {
  await connection();
  const [invoices, settings, payments] = await Promise.all([
    getInvoices(),
    getSettings(),
    getPayments(),
  ]);
  const today = todayISO();

  let outstandingMinor = 0;
  let outstandingCount = 0;
  let overdueMinor = 0;
  let overdueCount = 0;
  let paidMinor = 0;
  let paidCount = 0;
  let drafts = 0;

  for (const invoice of invoices) {
    const totalMinor = effectiveTotalMinor(invoice);
    const invoicePayments = payments.filter((payment) => payment.invoiceId === invoice.id);
    const status: DerivedStatus = deriveStatus(
      { status: invoice.status, dueDate: invoice.dueDate, totalMinor },
      invoicePayments,
      today,
    );
    if (status === "draft") {
      drafts += 1;
      continue;
    }
    if (status === "paid" || status === "void") {
      if (status === "paid") {
        paidMinor += totalMinor;
        paidCount += 1;
      }
      continue;
    }
    // issued / partially_paid / overdue → money still owed
    const balanceMinor = computeTotals({ ...invoice, payments: invoicePayments }).balanceMinor;
    outstandingMinor += balanceMinor;
    outstandingCount += 1;
    if (status === "overdue") {
      overdueMinor += balanceMinor;
      overdueCount += 1;
    }
  }

  const stats = [
    {
      label: "Outstanding",
      value: `${outstandingCount} awaiting payment`,
      money: outstandingMinor,
    },
    {
      label: "Overdue",
      value: `${overdueCount} past due`,
      money: overdueMinor,
      danger: overdueCount > 0,
    },
    {
      label: "Paid",
      value: `${paidCount} invoice${paidCount === 1 ? "" : "s"} settled`,
      money: paidMinor,
    },
    {
      label: "Drafts",
      value: `${drafts} not issued yet`,
      money: null,
    },
  ];

  return (
    <div className="p-6 lg:p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              {invoices.length} invoice{invoices.length === 1 ? "" : "s"} · currency {settings.currency}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ExportCsvButton />
            <Button render={<Link href="/invoices/new" />} className="gap-2">
              <Plus data-icon="inline-start" className="size-4" />
              New invoice
            </Button>
          </div>
        </div>

        {!settings.setupCompleted && <FirstRunSetup settings={settings} />}

        <div className="mb-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="rounded-xl border bg-card p-4">
              <p className="text-xs text-muted-foreground">{stat.label}</p>
              {stat.money === null ? (
                <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">{drafts}</p>
              ) : (
                <p
                  className={`mt-1 font-mono text-2xl font-semibold tabular-nums ${
                    stat.danger ? "text-red-600 dark:text-red-400" : ""
                  }`}
                >
                  {formatMinorMoney(stat.money, settings.currency)}
                </p>
              )}
              <p className="mt-0.5 text-xs text-muted-foreground">{stat.value}</p>
            </div>
          ))}
        </div>

        <InvoiceTable invoices={invoices} payments={payments} />
      </div>
    </div>
  );
}
