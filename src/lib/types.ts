import { z } from "zod";

export const INVOICE_STATUSES = ["draft", "issued", "void"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** Money-state labels derived from payments and the due date — never stored. */
export const DERIVED_STATUSES = [
  "draft",
  "issued",
  "partially_paid",
  "paid",
  "overdue",
  "void",
] as const;
export type DerivedStatus = (typeof DERIVED_STATUSES)[number];

export const CURRENCIES = [
  "USD", "EUR", "GBP", "INR", "JPY", "CNY", "CAD", "AUD", "NZD", "CHF",
  "SEK", "NOK", "MXN", "BRL", "ZAR", "SGD", "HKD", "AED",
] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Line item: quantity in milli-units, unit price in minor units (integer domain). */
export const lineItemSchema = z.object({
  id: z.string(),
  description: z.string().min(1, "Description is required"),
  quantityMilli: z.number().int().min(0),
  unitPriceMinor: z.number().int().min(0),
});
export type LineItem = z.infer<typeof lineItemSchema>;

export const customerSnapshotSchema = z.object({
  name: z.string().min(1, "Customer name is required"),
  email: z.string().default(""),
  address: z.string().default(""),
});
export type CustomerSnapshot = z.infer<typeof customerSnapshotSchema>;

/** Totals frozen at issue time — the invoice keeps rendering from this forever. */
export const issuedTotalsSchema = z.object({
  subtotalMinor: z.number().int().min(0),
  discountMinor: z.number().int().min(0),
  taxMinor: z.number().int().min(0),
  totalMinor: z.number().int().min(0),
});
export type IssuedTotals = z.infer<typeof issuedTotalsSchema>;

export const issuedSnapshotSchema = z.object({
  issuedAt: z.string(),
  customer: customerSnapshotSchema,
  totals: issuedTotalsSchema,
});
export type IssuedSnapshot = z.infer<typeof issuedSnapshotSchema>;

export const invoiceSchema = z.object({
  id: z.string(),
  number: z.string().min(1, "Invoice number is required"),
  status: z.enum(INVOICE_STATUSES),
  /** For issued invoices this is the issue date. */
  issueDate: z.string().min(1),
  dueDate: z.string().min(1),
  customerId: z.string().nullable().default(null),
  customer: customerSnapshotSchema,
  items: z.array(lineItemSchema).min(1, "Add at least one line item"),
  /** Tax rate in basis points (8.5% → 850). */
  taxRateBps: z.number().int().min(0).max(10_000).default(0),
  discountMinor: z.number().int().min(0).default(0),
  currency: z.string().default("USD"),
  notes: z.string().default(""),
  terms: z.string().default(""),
  issuedSnapshot: issuedSnapshotSchema.nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Invoice = z.infer<typeof invoiceSchema>;

/** Payload accepted by POST /api/invoices (server assigns id + timestamps). */
export const invoiceInputSchema = z.object({
  number: z.string().optional(),
  status: z.enum(INVOICE_STATUSES),
  issueDate: z.string().min(1),
  dueDate: z.string().min(1),
  customerId: z.string().nullable().optional(),
  customer: customerSnapshotSchema,
  items: z.array(lineItemSchema).min(1, "Add at least one line item"),
  taxRateBps: z.number().int().min(0).max(10_000).default(0),
  discountMinor: z.number().int().min(0).default(0),
  currency: z.string().default("USD"),
  notes: z.string().default(""),
  terms: z.string().default(""),
});

export const customerSchema = z.object({
  id: z.string(),
  name: z.string().min(1, "Name is required"),
  email: z.string().default(""),
  address: z.string().default(""),
  createdAt: z.string(),
});
export type Customer = z.infer<typeof customerSchema>;

/** Payload accepted by POST /api/customers. */
export const customerInputSchema = customerSchema.omit({ id: true, createdAt: true });

export const paymentSchema = z.object({
  id: z.string(),
  invoiceId: z.string(),
  /** Amount received, integer minor units, always positive. */
  amountMinor: z.number().int().positive(),
  /** Date the payment was received (YYYY-MM-DD). */
  date: z.string().min(1),
  method: z.string().default(""),
  note: z.string().default(""),
  createdAt: z.string(),
});
export type Payment = z.infer<typeof paymentSchema>;

/** Payload accepted by the payments endpoints. */
export const paymentInputSchema = paymentSchema.omit({ id: true, createdAt: true });

export const settingsSchema = z.object({
  companyName: z.string().default("My Company"),
  companyEmail: z.string().default(""),
  companyAddress: z.string().default(""),
  paymentDetails: z.string().default(""),
  currency: z.string().default("USD"),
  defaultTaxRate: z.number().min(0).max(100).default(0),
  defaultTerms: z.string().default("Payment due within 30 days."),
  nextInvoiceNumber: z.number().int().min(1).default(1),
  numberPrefix: z.string().default("INV"),
  numberSeparator: z.string().default("-"),
  numberPadding: z.number().int().min(1).max(10).default(4),
  aiModel: z.string().default("gemma2:2b"),
  /** Flips to true when the first-run business setup has been completed or skipped. */
  setupCompleted: z.boolean().default(false),
});
export type Settings = z.infer<typeof settingsSchema>;

/** Payload accepted by PUT /api/settings (partial merge). */
export const settingsInputSchema = settingsSchema.partial();
