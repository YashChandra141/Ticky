import { describe, expect, it } from "vitest";
import {
  ALLOWED_TRANSITIONS,
  buildIssuedSnapshot,
  canEditCustomer,
  canEditItems,
  canTransition,
  deriveStatus,
  itemsEqual,
} from "./status";
import type { Invoice, Payment } from "@/lib/types";

const TODAY = "2026-10-16";
const future = "2026-11-15";
const past = "2026-10-01";

function payment(amountMinor: number): Payment {
  return {
    id: `p-${amountMinor}`,
    invoiceId: "inv",
    amountMinor,
    date: TODAY,
    method: "Bank transfer",
    note: "",
    createdAt: "2026-10-16T00:00:00.000Z",
  };
}

describe("deriveStatus", () => {
  it("draft ignores payments entirely", () => {
    const invoice = { status: "draft" as const, dueDate: past, totalMinor: 10000 };
    expect(deriveStatus(invoice, [payment(10000)], TODAY)).toBe("draft");
  });

  it("void stays void", () => {
    const invoice = { status: "void" as const, dueDate: future, totalMinor: 10000 };
    expect(deriveStatus(invoice, [], TODAY)).toBe("void");
  });

  it("marks paid when payments cover the total", () => {
    const invoice = { status: "issued" as const, dueDate: future, totalMinor: 10000 };
    expect(deriveStatus(invoice, [payment(10000)], TODAY)).toBe("paid");
    expect(deriveStatus(invoice, [payment(6000), payment(4000)], TODAY)).toBe("paid");
  });

  it("overpayment still reads as paid", () => {
    const invoice = { status: "issued" as const, dueDate: future, totalMinor: 10000 };
    expect(deriveStatus(invoice, [payment(12000)], TODAY)).toBe("paid");
  });

  it("overdue wins over partially paid — late money is the actionable fact", () => {
    const invoice = { status: "issued" as const, dueDate: past, totalMinor: 10000 };
    expect(deriveStatus(invoice, [payment(4000)], TODAY)).toBe("overdue");
  });

  it("partially paid when some money arrived and it is not late yet", () => {
    const invoice = { status: "issued" as const, dueDate: future, totalMinor: 10000 };
    expect(deriveStatus(invoice, [payment(4000)], TODAY)).toBe("partially_paid");
  });

  it("issued when nothing was paid and it is not due yet", () => {
    const invoice = { status: "issued" as const, dueDate: future, totalMinor: 10000 };
    expect(deriveStatus(invoice, [], TODAY)).toBe("issued");
  });

  it("due today is not overdue (strictly past due)", () => {
    const invoice = { status: "issued" as const, dueDate: TODAY, totalMinor: 10000 };
    expect(deriveStatus(invoice, [], TODAY)).toBe("issued");
  });

  it("a zero-total issued invoice counts as paid", () => {
    const invoice = { status: "issued" as const, dueDate: future, totalMinor: 0 };
    expect(deriveStatus(invoice, [], TODAY)).toBe("paid");
  });
});

describe("transitions", () => {
  it("allows exactly draft → issued and issued → void", () => {
    expect(canTransition("draft", "issued")).toBe(true);
    expect(canTransition("issued", "void")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(canTransition("draft", "void")).toBe(false);
    expect(canTransition("issued", "draft")).toBe(false);
    expect(canTransition("issued", "issued")).toBe(false);
    expect(canTransition("void", "draft")).toBe(false);
    expect(ALLOWED_TRANSITIONS.void).toEqual([]);
  });

  it("freezes items and customer outside draft", () => {
    expect(canEditItems("draft")).toBe(true);
    expect(canEditItems("issued")).toBe(false);
    expect(canEditItems("void")).toBe(false);
    expect(canEditCustomer("draft")).toBe(true);
    expect(canEditCustomer("issued")).toBe(false);
  });
});

describe("buildIssuedSnapshot", () => {
  it("freezes customer and totals at issue time", () => {
    const invoice: Pick<Invoice, "customer" | "items" | "taxRateBps" | "discountMinor"> = {
      customer: { name: "Acme", email: "billing@acme.com", address: "42 Market St" },
      items: [
        { id: "i-1", description: "Consulting hours", quantityMilli: 12000, unitPriceMinor: 15000 },
      ],
      taxRateBps: 800,
      discountMinor: 0,
    };
    const snapshot = buildIssuedSnapshot(invoice, "2026-10-16T10:00:00.000Z");
    expect(snapshot.issuedAt).toBe("2026-10-16T10:00:00.000Z");
    expect(snapshot.customer.name).toBe("Acme");
    // 12 × $150 = $1800, tax 8% = $144 → $1944
    expect(snapshot.totals).toEqual({
      subtotalMinor: 180000,
      discountMinor: 0,
      taxMinor: 14400,
      totalMinor: 194400,
    });
  });

  it("includes the discount in the frozen totals", () => {
    const snapshot = buildIssuedSnapshot(
      {
        customer: { name: "X", email: "", address: "" },
        items: [{ id: "i-1", description: "Work", quantityMilli: 1000, unitPriceMinor: 10000 }],
        taxRateBps: 0,
        discountMinor: 500,
      },
      "2026-10-16T10:00:00.000Z",
    );
    expect(snapshot.totals.subtotalMinor).toBe(10000);
    expect(snapshot.totals.discountMinor).toBe(500);
    expect(snapshot.totals.totalMinor).toBe(9500);
  });
});

describe("itemsEqual", () => {
  const base = [
    { id: "a", description: "One", quantityMilli: 1000, unitPriceMinor: 100 },
    { id: "b", description: "Two", quantityMilli: 2000, unitPriceMinor: 200 },
  ];

  it("matches identical items regardless of order", () => {
    expect(itemsEqual(base, [base[1], base[0]])).toBe(true);
  });

  it("detects changed prices", () => {
    expect(itemsEqual(base, [{ ...base[0], unitPriceMinor: 999 }, base[1]])).toBe(false);
  });

  it("detects added and removed lines", () => {
    expect(itemsEqual(base, [base[0]])).toBe(false);
    expect(itemsEqual(base, [...base, { id: "c", description: "Three", quantityMilli: 1, unitPriceMinor: 1 }])).toBe(false);
  });
});
