"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Download, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/status-badge";
import { Money } from "@/components/money";
import { formatDate, todayISO } from "@/lib/format";
import { effectiveTotalMinor } from "@/lib/totals";
import { deriveStatus, type DerivedStatus } from "@/lib/domain/status";
import type { Invoice, Payment } from "@/lib/types";
import { cn } from "@/lib/utils";

type Filter = "all" | DerivedStatus;

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "issued", label: "Issued" },
  { key: "partially_paid", label: "Partially paid" },
  { key: "paid", label: "Paid" },
  { key: "overdue", label: "Overdue" },
  { key: "void", label: "Void" },
];

export function InvoiceTable({
  invoices,
  payments = [],
}: {
  invoices: Invoice[];
  payments?: Payment[];
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const paymentsByInvoice = useMemo(() => {
    const map = new Map<string, Payment[]>();
    for (const payment of payments) {
      const list = map.get(payment.invoiceId) ?? [];
      list.push(payment);
      map.set(payment.invoiceId, list);
    }
    return map;
  }, [payments]);

  const derived = useMemo(() => {
    const today = todayISO();
    const map = new Map<string, DerivedStatus>();
    for (const invoice of invoices) {
      map.set(
        invoice.id,
        deriveStatus(
          { status: invoice.status, dueDate: invoice.dueDate, totalMinor: effectiveTotalMinor(invoice) },
          paymentsByInvoice.get(invoice.id) ?? [],
          today,
        ),
      );
    }
    return map;
  }, [invoices, paymentsByInvoice]);

  const counts = useMemo(() => {
    const result: Record<Filter, number> = {
      all: invoices.length,
      draft: 0,
      issued: 0,
      partially_paid: 0,
      paid: 0,
      overdue: 0,
      void: 0,
    };
    for (const status of derived.values()) result[status] += 1;
    return result;
  }, [invoices, derived]);

  const visible = useMemo(() => {
    const sorted = [...invoices].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const q = query.trim().toLowerCase();
    const matchesQuery = (invoice: Invoice) =>
      !q ||
      invoice.number.toLowerCase().includes(q) ||
      (invoice.issuedSnapshot?.customer.name ?? invoice.customer.name).toLowerCase().includes(q);
    if (filter === "all") return sorted.filter(matchesQuery);
    return sorted.filter((invoice) => derived.get(invoice.id) === filter && matchesQuery(invoice));
  }, [invoices, filter, derived, query]);

  if (invoices.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-12 text-center">
        <p className="text-sm text-muted-foreground">No invoices yet.</p>
        <Button render={<Link href="/invoices/new" />} className="mt-4 gap-2">
          <Plus data-icon="inline-start" className="size-4" />
          Create your first invoice
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {FILTERS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={cn(
                "rounded-full px-3 py-1 text-xs transition-colors",
                filter === key
                  ? "bg-primary/10 font-medium text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {label}
              <span className="ml-1.5 font-mono tabular-nums opacity-70">{counts[key]}</span>
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-56">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search number or customer"
            className="h-8 pl-8 text-sm"
            aria-label="Search invoices"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">Invoice</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Issued</th>
              <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Due</th>
              <th className="px-4 py-2.5 text-right font-medium">Total</th>
              <th className="w-10 px-2 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {visible.map((invoice) => (
              <tr
                key={invoice.id}
                onClick={() => router.push(`/invoices/${invoice.id}`)}
                className="cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40"
              >
                <td className="px-4 py-3">
                  <div className="font-mono font-medium">{invoice.number}</div>
                  <div className="text-xs text-muted-foreground">
                    {invoice.issuedSnapshot?.customer.name ?? invoice.customer.name}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge invoice={invoice} payments={paymentsByInvoice.get(invoice.id) ?? []} />
                </td>
                <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
                  {invoice.status === "draft" ? "—" : formatDate(invoice.issueDate)}
                </td>
                <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
                  {formatDate(invoice.dueDate)}
                </td>
                <td className="px-4 py-3 text-right">
                  <Money minor={effectiveTotalMinor(invoice)} currency={invoice.currency} />
                </td>
                <td className="px-2 py-3">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    title="Download PDF"
                    onClick={(event) => {
                      event.stopPropagation();
                      const link = document.createElement("a");
                      link.href = `/api/invoices/${invoice.id}/pdf`;
                      link.download = "";
                      document.body.appendChild(link);
                      link.click();
                      link.remove();
                    }}
                  >
                    <Download className="size-3.5 text-muted-foreground" />
                  </Button>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No invoices in this view.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
