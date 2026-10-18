import { cn } from "@/lib/utils";
import { todayISO } from "@/lib/format";
import { effectiveTotalMinor } from "@/lib/totals";
import { deriveStatus, type DerivedStatus } from "@/lib/domain/status";
import type { Invoice, Payment } from "@/lib/types";

const STYLES: Record<DerivedStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  issued: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  partially_paid: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  paid: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  overdue: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  void: "bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

const LABELS: Record<DerivedStatus, string> = {
  draft: "Draft",
  issued: "Issued",
  partially_paid: "Partially paid",
  paid: "Paid",
  overdue: "Overdue",
  void: "Void",
};

export function StatusBadge({
  invoice,
  payments = [],
}: {
  invoice: Invoice;
  payments?: ReadonlyArray<Payment>;
}) {
  const status = deriveStatus(
    { status: invoice.status, dueDate: invoice.dueDate, totalMinor: effectiveTotalMinor(invoice) },
    payments,
    todayISO(),
  );
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        STYLES[status],
      )}
    >
      <span className="size-1.5 rounded-full bg-current opacity-70" />
      {LABELS[status]}
    </span>
  );
}
