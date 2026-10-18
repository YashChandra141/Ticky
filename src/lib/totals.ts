import { lineAmountMinor, taxMinor } from "./domain/money";
import type { Invoice, Payment } from "./types";

export type Totals = {
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  amountPaidMinor: number;
  balanceMinor: number;
};

/**
 * All-integer totals. Per-line amounts and tax are each rounded half-up
 * exactly once; discount is clamped to the subtotal; balance can be
 * negative on overpayment.
 */
export function computeTotals(input: {
  items: ReadonlyArray<{ quantityMilli: number; unitPriceMinor: number }>;
  taxRateBps: number;
  discountMinor: number;
  payments?: ReadonlyArray<Pick<Payment, "amountMinor">>;
}): Totals {
  const subtotalMinor = input.items.reduce(
    (sum, item) => sum + lineAmountMinor(item.quantityMilli, item.unitPriceMinor),
    0,
  );
  const discountMinor = Math.min(Math.max(input.discountMinor || 0, 0), subtotalMinor);
  const taxableMinor = subtotalMinor - discountMinor;
  const tax = taxMinor(taxableMinor, Math.max(0, input.taxRateBps || 0));
  const totalMinor = taxableMinor + tax;
  const amountPaidMinor = (input.payments ?? []).reduce((sum, payment) => sum + payment.amountMinor, 0);
  return {
    subtotalMinor,
    discountMinor,
    taxMinor: tax,
    totalMinor,
    amountPaidMinor,
    balanceMinor: totalMinor - amountPaidMinor,
  };
}

/**
 * The total an invoice is *accounted* at: the frozen issue snapshot once
 * issued, otherwise the live computation. Payments, badges, dashboards
 * and PDFs must all agree on this number.
 */
export function effectiveTotalMinor(
  invoice: Pick<Invoice, "issuedSnapshot" | "items" | "taxRateBps" | "discountMinor">,
): number {
  return invoice.issuedSnapshot?.totals.totalMinor ?? computeTotals(invoice).totalMinor;
}

/** Totals block for display: snapshot when frozen, live when still a draft. */
export function effectiveTotals(
  invoice: Pick<Invoice, "issuedSnapshot" | "items" | "taxRateBps" | "discountMinor">,
): Pick<Totals, "subtotalMinor" | "discountMinor" | "taxMinor" | "totalMinor"> {
  const snapshot = invoice.issuedSnapshot?.totals;
  if (snapshot) return snapshot;
  const live = computeTotals(invoice);
  return {
    subtotalMinor: live.subtotalMinor,
    discountMinor: live.discountMinor,
    taxMinor: live.taxMinor,
    totalMinor: live.totalMinor,
  };
}
