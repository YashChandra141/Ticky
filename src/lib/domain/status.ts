import type { DerivedStatus, Invoice, InvoiceStatus, IssuedSnapshot, Payment } from "@/lib/types";
import { computeTotals } from "@/lib/totals";

export type { DerivedStatus };

/**
 * Stored statuses are only draft | issued | void. Everything about money is
 * derived: paid / partially_paid from payments, overdue from the due date.
 * They can therefore never drift out of sync with reality.
 *
 * Precedence (after stored state): paid → overdue → partially_paid → issued.
 * An invoice that is partially paid AND past due reads as overdue, because
 * the outstanding money is late — that's the actionable fact.
 */
export function deriveStatus(
  invoice: Pick<Invoice, "status" | "dueDate"> & { totalMinor: number },
  payments: ReadonlyArray<Pick<Payment, "amountMinor">>,
  today: string,
): DerivedStatus {
  if (invoice.status === "draft") return "draft";
  if (invoice.status === "void") return "void";
  const amountPaidMinor = payments.reduce((sum, payment) => sum + payment.amountMinor, 0);
  if (amountPaidMinor >= invoice.totalMinor) return "paid";
  if (invoice.dueDate < today) return "overdue";
  if (amountPaidMinor > 0) return "partially_paid";
  return "issued";
}

export const ALLOWED_TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  draft: ["issued"],
  issued: ["void"],
  void: [],
};

export function canTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return from !== to && ALLOWED_TRANSITIONS[from].includes(to);
}

/** Items are frozen the moment an invoice leaves draft. */
export function canEditItems(status: InvoiceStatus): boolean {
  return status === "draft";
}

/** The customer block is frozen with the items. */
export function canEditCustomer(status: InvoiceStatus): boolean {
  return status === "draft";
}

/** Freezes customer + totals at issue time. Called once, on the first transition to issued. */
export function buildIssuedSnapshot(
  invoice: Pick<Invoice, "customer" | "items" | "taxRateBps" | "discountMinor">,
  issuedAt: string,
): IssuedSnapshot {
  const totals = computeTotals(invoice);
  return {
    issuedAt,
    customer: { name: invoice.customer.name, email: invoice.customer.email, address: invoice.customer.address },
    totals: {
      subtotalMinor: totals.subtotalMinor,
      discountMinor: totals.discountMinor,
      taxMinor: totals.taxMinor,
      totalMinor: totals.totalMinor,
    },
  };
}

/** Order-insensitive line-item comparison, used to enforce the freeze rule. */
export function itemsEqual(
  a: ReadonlyArray<{ id: string; description: string; quantityMilli: number; unitPriceMinor: number }>,
  b: ReadonlyArray<{ id: string; description: string; quantityMilli: number; unitPriceMinor: number }>,
): boolean {
  if (a.length !== b.length) return false;
  const key = (item: { id: string }) => item.id;
  const map = new Map(a.map((item) => [key(item), item] as const));
  return b.every((item) => {
    const match = map.get(key(item));
    return (
      match !== undefined &&
      match.description === item.description &&
      match.quantityMilli === item.quantityMilli &&
      match.unitPriceMinor === item.unitPriceMinor
    );
  });
}
