import { z } from "zod";

/**
 * JSON Schemas passed to Ollama's structured-output `format` parameter.
 * They grammatically constrain generation so even small local models
 * return parseable invoice data.
 */

const customerSchemaJson = {
  type: "object",
  properties: {
    name: { type: "string" },
    email: { type: "string" },
    address: { type: "string" },
  },
  required: ["name", "email", "address"],
} as const;

const itemsSchemaJson = {
  type: "array",
  items: {
    type: "object",
    properties: {
      description: { type: "string" },
      quantity: { type: "number" },
      unitPrice: { type: "number" },
    },
    required: ["description", "quantity", "unitPrice"],
  },
} as const;

export const draftJsonSchema = {
  type: "object",
  properties: {
    customer: customerSchemaJson,
    items: itemsSchemaJson,
    taxRate: { type: "number" },
    dueInDays: { type: "number" },
    notes: { type: "string" },
    terms: { type: "string" },
  },
  required: ["customer", "items", "taxRate", "dueInDays", "notes", "terms"],
} as const;

export const extractJsonSchema = {
  type: "object",
  properties: {
    customer: customerSchemaJson,
    items: itemsSchemaJson,
  },
  required: ["customer", "items"],
} as const;

export const polishJsonSchema = {
  type: "object",
  properties: {
    text: { type: "string" },
  },
  required: ["text"],
} as const;

// ---------- results shared with client components ----------

export type AiCustomer = { name: string; email: string; address: string };
export type AiItem = { description: string; quantity: number; unitPrice: number };

export type AiDraftResult = {
  customer: AiCustomer;
  items: AiItem[];
  taxRate: number;
  dueInDays: number;
  notes: string;
  terms: string;
  model: string;
};

export type AiExtractResult = {
  customer: AiCustomer;
  items: AiItem[];
  model: string;
};

// ---------- normalization (models are small; be forgiving) ----------

const money = (value: number): number => Math.max(0, Math.round(value * 100) / 100);

const aiCustomerZ = z.object({
  name: z.string().catch(""),
  email: z.string().catch(""),
  address: z.string().catch(""),
});

const aiItemZ = z.object({
  description: z.string().catch(""),
  quantity: z.coerce.number().catch(1),
  unitPrice: z.coerce.number().catch(0),
});

function normalizeCustomer(raw: z.infer<typeof aiCustomerZ>): AiCustomer {
  return {
    name: raw.name.trim(),
    email: raw.email.trim(),
    address: raw.address.trim(),
  };
}

function normalizeItems(raw: z.infer<typeof aiItemZ>[]): AiItem[] {
  return raw
    .map((item) => ({
      description: item.description.trim(),
      quantity: money(item.quantity),
      unitPrice: money(item.unitPrice),
    }))
    .filter((item) => item.description.length > 0);
}

export function normalizeDraft(raw: unknown): Omit<AiDraftResult, "model"> {
  const parsed = z
    .object({
      customer: aiCustomerZ.catch({ name: "", email: "", address: "" }),
      items: z.array(aiItemZ).catch([]),
      taxRate: z.coerce.number().catch(0),
      dueInDays: z.coerce.number().catch(30),
      notes: z.string().catch(""),
      terms: z.string().catch(""),
    })
    .parse(raw);

  return {
    customer: normalizeCustomer(parsed.customer),
    items: normalizeItems(parsed.items),
    taxRate: Math.min(Math.max(parsed.taxRate || 0, 0), 100),
    dueInDays: Math.min(Math.max(Math.round(parsed.dueInDays || 30), 0), 365),
    notes: parsed.notes.trim(),
    terms: parsed.terms.trim(),
  };
}

export function normalizeExtract(raw: unknown): Omit<AiExtractResult, "model"> {
  const parsed = z
    .object({
      customer: aiCustomerZ.catch({ name: "", email: "", address: "" }),
      items: z.array(aiItemZ).catch([]),
    })
    .parse(raw);

  return {
    customer: normalizeCustomer(parsed.customer),
    items: normalizeItems(parsed.items),
  };
}

export function normalizePolish(raw: unknown): string {
  const parsed = z.object({ text: z.string().catch("") }).parse(raw);
  return parsed.text.trim();
}

// ---------- draft clarification ----------

/**
 * What the model couldn't infer from the prompt. Instead of silently filling
 * zeros, the copilot asks these questions before the draft is applied.
 */
export type DraftQuestions = {
  customerName: string;
  items: string;
  unitPrices: string;
  quantities: string;
};

export function missingFields(
  draft: Pick<AiDraftResult, "customer" | "items">,
): DraftQuestions | null {
  const questions: Partial<DraftQuestions> = {};
  if (!draft.customer.name) {
    questions.customerName = "Who is this invoice for? Add the customer's name.";
  }
  if (draft.items.length === 0) {
    questions.items = "Nothing was found to invoice — what was sold?";
  }
  if (draft.items.some((item) => item.unitPrice <= 0)) {
    questions.unitPrices = "Some items have no price — what should they cost?";
  }
  if (draft.items.some((item) => item.quantity <= 0)) {
    questions.quantities = "Some items have no quantity — how many of each?";
  }
  if (Object.keys(questions).length === 0) return null;
  return questions as DraftQuestions;
}

// ---------- customer matching ----------

export type CustomerMatch<TCustomer> =
  | { kind: "exact"; customer: TCustomer }
  | { kind: "candidates"; customers: TCustomer[] }
  | { kind: "none" };

const normalizeForMatch = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

const tokensOf = (value: string): Set<string> =>
  new Set(normalizeForMatch(value).split(" ").filter((token) => token.length > 1));

function fuzzyScore(draftName: string, customerName: string): number {
  const a = tokensOf(draftName);
  const b = tokensOf(customerName);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  const union = new Set([...a, ...b]).size;
  const overlap = shared / union;
  const contains =
    normalizeForMatch(draftName).includes(normalizeForMatch(customerName)) ||
    normalizeForMatch(customerName).includes(normalizeForMatch(draftName))
      ? 0.9
      : 0;
  return Math.max(overlap, contains);
}

/**
 * Links an AI-drafted customer to the saved list: exact email or name matches
 * are auto-linked; fuzzy hits become candidates for the user to confirm.
 */
export function matchCustomers<TCustomer extends { name: string; email: string }>(
  customers: ReadonlyArray<TCustomer>,
  draft: { name: string; email: string },
): CustomerMatch<TCustomer> {
  const email = draft.email.trim().toLowerCase();
  if (email) {
    const byEmail = customers.find((customer) => customer.email.trim().toLowerCase() === email);
    if (byEmail) return { kind: "exact", customer: byEmail };
  }
  const name = draft.name.trim();
  if (name) {
    const byName = customers.find(
      (customer) => normalizeForMatch(customer.name) === normalizeForMatch(name),
    );
    if (byName) return { kind: "exact", customer: byName };
  }
  if (name) {
    const candidates = customers
      .map((customer) => ({ customer, score: fuzzyScore(name, customer.name) }))
      .filter((entry) => entry.score >= 0.34)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((entry) => entry.customer);
    if (candidates.length > 0) return { kind: "candidates", customers: candidates };
  }
  return { kind: "none" };
}
