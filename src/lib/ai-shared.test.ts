import { describe, expect, it } from "vitest";
import {
  matchCustomers,
  missingFields,
  normalizeDraft,
  normalizeExtract,
} from "./ai-shared";

describe("normalizeDraft", () => {
  const completeRaw = {
    customer: { name: "Acme Corp", email: "billing@acme.com", address: "42 Market St" },
    items: [{ description: "Consulting", quantity: 12, unitPrice: 150 }],
    taxRate: 8,
    dueInDays: 30,
    notes: "Thanks",
    terms: "Net 30",
  };

  it("normalizes a complete draft", () => {
    const draft = normalizeDraft(completeRaw);
    expect(draft.customer.name).toBe("Acme Corp");
    expect(draft.items).toEqual([{ description: "Consulting", quantity: 12, unitPrice: 150 }]);
    expect(draft.taxRate).toBe(8);
    expect(draft.dueInDays).toBe(30);
  });

  it("strips injected total fields — the app computes totals, never the model", () => {
    const draft = normalizeDraft({
      ...completeRaw,
      subtotal: 999,
      total: 1_000_000,
      taxTotal: 42,
      balance: -12,
    });
    expect(draft).not.toHaveProperty("total");
    expect(draft).not.toHaveProperty("subtotal");
    expect(draft).not.toHaveProperty("taxTotal");
    expect(draft).not.toHaveProperty("balance");
  });

  it("coerces wrong types instead of crashing", () => {
    const draft = normalizeDraft({
      customer: { name: 42, email: null, address: [] },
      items: [{ description: "Work", quantity: "12.5", unitPrice: "99.90" }],
      taxRate: "8",
      dueInDays: "30",
      notes: null,
      terms: undefined,
    });
    // name 42 → string by zod string catch? 42 is not a string → catch("")
    expect(draft.customer.name).toBe("");
    expect(draft.items[0].quantity).toBe(12.5);
    expect(draft.items[0].unitPrice).toBe(99.9);
    expect(draft.taxRate).toBe(8);
  });

  it("defaults junk quantities to 1 and clamps negative prices to 0", () => {
    const draft = normalizeDraft({
      customer: { name: "X", email: "", address: "" },
      items: [
        { description: "A", quantity: "not-a-number", unitPrice: 10 },
        { description: "B", quantity: 1, unitPrice: -5 },
      ],
      taxRate: 0,
      dueInDays: 30,
      notes: "",
      terms: "",
    });
    expect(draft.items[0].quantity).toBe(1);
    expect(draft.items[1].unitPrice).toBe(0);
  });

  it("survives an empty items list (clarification handles it)", () => {
    const draft = normalizeDraft({ ...completeRaw, items: [] });
    expect(draft.items).toEqual([]);
  });

  it("drops items with empty descriptions", () => {
    const draft = normalizeDraft({
      ...completeRaw,
      items: [
        { description: "  ", quantity: 1, unitPrice: 10 },
        { description: "Real work", quantity: 1, unitPrice: 10 },
      ],
    });
    expect(draft.items).toHaveLength(1);
    expect(draft.items[0].description).toBe("Real work");
  });
});

describe("normalizeExtract", () => {
  it("ignores injected totals too", () => {
    const extract = normalizeExtract({
      customer: { name: "Y", email: "", address: "" },
      items: [{ description: "Thing", quantity: 2, unitPrice: 5 }],
      total: 10,
    });
    expect(extract).not.toHaveProperty("total");
    expect(extract.items).toEqual([{ description: "Thing", quantity: 2, unitPrice: 5 }]);
  });

  it("survives missing customer and items", () => {
    const extract = normalizeExtract({});
    expect(extract.customer).toEqual({ name: "", email: "", address: "" });
    expect(extract.items).toEqual([]);
  });
});

describe("missingFields", () => {
  const complete = {
    customer: { name: "Acme", email: "", address: "" },
    items: [{ description: "Work", quantity: 2, unitPrice: 100 }],
  };

  it("returns null for a complete draft", () => {
    expect(missingFields(complete)).toBeNull();
  });

  it("asks for the customer name", () => {
    const questions = missingFields({ ...complete, customer: { name: "", email: "", address: "" } });
    expect(questions?.customerName).toMatch(/who is this invoice for/i);
  });

  it("asks what was sold when there are no items", () => {
    const questions = missingFields({ ...complete, items: [] });
    expect(questions?.items).toMatch(/what was sold/i);
  });

  it("asks for missing unit prices", () => {
    const questions = missingFields({
      ...complete,
      items: [{ description: "Work", quantity: 2, unitPrice: 0 }],
    });
    expect(questions?.unitPrices).toMatch(/what should they cost/i);
  });

  it("asks for missing quantities", () => {
    const questions = missingFields({
      ...complete,
      items: [{ description: "Work", quantity: 0, unitPrice: 100 }],
    });
    expect(questions?.quantities).toMatch(/how many/i);
  });

  it("collects several questions at once", () => {
    const questions = missingFields({
      customer: { name: "", email: "", address: "" },
      items: [{ description: "Work", quantity: 0, unitPrice: 0 }],
    });
    expect(questions).not.toBeNull();
    expect(Object.keys(questions!)).toEqual(
      expect.arrayContaining(["customerName", "unitPrices", "quantities"]),
    );
  });
});

describe("matchCustomers", () => {
  const customers = [
    { id: "1", name: "Acme Corp", email: "Billing@Acme.com" },
    { id: "2", name: "Acme Europe Ltd", email: "europe@acme.com" },
    { id: "3", name: "Initech", email: "ap@initech.dev" },
  ];

  it("links by email case-insensitively", () => {
    const match = matchCustomers(customers, { name: "Whoever", email: "billing@acme.com" });
    expect(match.kind).toBe("exact");
    if (match.kind === "exact") expect(match.customer.id).toBe("1");
  });

  it("links by name ignoring case and punctuation", () => {
    const match = matchCustomers(customers, { name: "acme corp", email: "" });
    expect(match.kind).toBe("exact");
  });

  it("offers fuzzy candidates instead of guessing", () => {
    const match = matchCustomers(customers, { name: "Acme", email: "unknown@x.io" });
    expect(match.kind).toBe("candidates");
    if (match.kind === "candidates") {
      expect(match.customers.map((c) => c.id)).toContain("1");
      expect(match.customers.map((c) => c.id)).toContain("2");
      expect(match.customers).toHaveLength(2);
    }
  });

  it("returns none for unrelated names", () => {
    const match = matchCustomers(customers, { name: "Totally Different Co", email: "" });
    expect(match.kind).toBe("none");
  });

  it("returns none when the draft has no name or email", () => {
    expect(matchCustomers(customers, { name: "", email: "" }).kind).toBe("none");
  });
});
