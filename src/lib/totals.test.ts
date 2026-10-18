import { describe, expect, it } from "vitest";
import { computeTotals, effectiveTotalMinor, effectiveTotals } from "@/lib/totals";
import type { Invoice } from "@/lib/types";

describe("computeTotals (integer domain)", () => {
  it("sums line amounts rounded once per line", () => {
    const totals = computeTotals({
      items: [
        { quantityMilli: 1000, unitPriceMinor: 250000 }, // $2500.00
        { quantityMilli: 1000, unitPriceMinor: 80000 }, //  $800.00
      ],
      taxRateBps: 0,
      discountMinor: 0,
    });
    expect(totals.subtotalMinor).toBe(330000);
    expect(totals.totalMinor).toBe(330000);
    expect(totals.taxMinor).toBe(0);
  });

  it("computes tax half-up on the discounted amount, once", () => {
    const totals = computeTotals({
      items: [{ quantityMilli: 12000, unitPriceMinor: 15000 }], // 12 × $150 = $1800
      taxRateBps: 800,
      discountMinor: 0,
    });
    expect(totals.taxMinor).toBe(14400); // 8% of $1800 = $144
    expect(totals.totalMinor).toBe(194400);
  });

  it("clamps discounts above the subtotal", () => {
    const totals = computeTotals({
      items: [{ quantityMilli: 1000, unitPriceMinor: 5000 }], // $50
      taxRateBps: 1000,
      discountMinor: 999999,
    });
    expect(totals.discountMinor).toBe(5000);
    expect(totals.taxMinor).toBe(0);
    expect(totals.totalMinor).toBe(0);
  });

  it("applies discount before tax", () => {
    const totals = computeTotals({
      items: [{ quantityMilli: 1000, unitPriceMinor: 10000 }], // $100
      taxRateBps: 1000, // 10%
      discountMinor: 2000, // $20
    });
    // taxable $80 → tax $8 → total $88
    expect(totals.totalMinor).toBe(8800);
  });

  it("folds payments into amount paid and balance", () => {
    const totals = computeTotals({
      items: [{ quantityMilli: 1000, unitPriceMinor: 194400 }],
      taxRateBps: 0,
      discountMinor: 0,
      payments: [{ amountMinor: 100000 }, { amountMinor: 44400 }],
    });
    expect(totals.amountPaidMinor).toBe(144400);
    expect(totals.balanceMinor).toBe(50000);
  });

  it("allows a negative balance on overpayment", () => {
    const totals = computeTotals({
      items: [{ quantityMilli: 1000, unitPriceMinor: 10000 }],
      taxRateBps: 0,
      discountMinor: 0,
      payments: [{ amountMinor: 15000 }],
    });
    expect(totals.balanceMinor).toBe(-5000);
  });

  it("treats missing payments as zero paid", () => {
    const totals = computeTotals({
      items: [{ quantityMilli: 1000, unitPriceMinor: 10000 }],
      taxRateBps: 0,
      discountMinor: 0,
    });
    expect(totals.amountPaidMinor).toBe(0);
    expect(totals.balanceMinor).toBe(10000);
  });
});

describe("snapshot-aware totals", () => {
  const draft: Pick<Invoice, "issuedSnapshot" | "items" | "taxRateBps" | "discountMinor"> = {
    issuedSnapshot: null,
    items: [{ id: "i", description: "Work", quantityMilli: 1000, unitPriceMinor: 10000 }],
    taxRateBps: 500,
    discountMinor: 0,
  };

  const issued: typeof draft = {
    ...draft,
    issuedSnapshot: {
      issuedAt: "2026-10-16T10:00:00.000Z",
      customer: { name: "Acme", email: "", address: "" },
      totals: { subtotalMinor: 10000, discountMinor: 0, taxMinor: 400, totalMinor: 10400 },
    },
  };

  it("uses live computation for drafts", () => {
    expect(effectiveTotalMinor(draft)).toBe(10500);
  });

  it("uses the frozen snapshot once issued, even if the live items changed", () => {
    const mutated: typeof issued = {
      ...issued,
      items: [{ id: "i", description: "Changed", quantityMilli: 9000, unitPriceMinor: 10000 }],
    };
    expect(effectiveTotalMinor(mutated)).toBe(10400);
    expect(effectiveTotals(mutated).totalMinor).toBe(10400);
  });
});
