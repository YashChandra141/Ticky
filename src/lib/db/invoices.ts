import { getDb, transact } from "./connection";
import { DuplicateInvoiceNumberError } from "./errors";
import type { CustomerSnapshot, Invoice, InvoiceStatus, IssuedSnapshot } from "../types";

type InvoiceRow = {
  id: string;
  number: string;
  status: InvoiceStatus;
  issue_date: string;
  due_date: string;
  customer_id: string | null;
  customer_snapshot: string;
  tax_rate_bps: number;
  discount_minor: number;
  currency: string;
  notes: string;
  terms: string;
  issued_snapshot: string | null;
  created_at: string;
  updated_at: string;
};

type ItemRow = {
  id: string;
  invoice_id: string;
  position: number;
  description: string;
  quantity_milli: number;
  unit_price_minor: number;
};

/** What the storage layer needs to fully write an invoice. */
export type InvoiceWrite = {
  number: string;
  status: InvoiceStatus;
  issueDate: string;
  dueDate: string;
  customerId: string | null;
  customer: CustomerSnapshot;
  items: Array<{ id: string; description: string; quantityMilli: number; unitPriceMinor: number }>;
  taxRateBps: number;
  discountMinor: number;
  currency: string;
  notes: string;
  terms: string;
  issuedSnapshot: IssuedSnapshot | null;
};

function mapInvoice(row: InvoiceRow, items: ItemRow[]): Invoice {
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    issueDate: row.issue_date,
    dueDate: row.due_date,
    customerId: row.customer_id,
    customer: JSON.parse(row.customer_snapshot) as CustomerSnapshot,
    items: items.map((item) => ({
      id: item.id,
      description: item.description,
      quantityMilli: item.quantity_milli,
      unitPriceMinor: item.unit_price_minor,
    })),
    taxRateBps: row.tax_rate_bps,
    discountMinor: row.discount_minor,
    currency: row.currency,
    notes: row.notes,
    terms: row.terms,
    issuedSnapshot: row.issued_snapshot ? (JSON.parse(row.issued_snapshot) as IssuedSnapshot) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listInvoices(): Invoice[] {
  const db = getDb();
  const invoiceRows = db.prepare("SELECT * FROM invoices ORDER BY created_at DESC, id").all() as InvoiceRow[];
  if (invoiceRows.length === 0) return [];
  const itemRows = db
    .prepare("SELECT * FROM invoice_items ORDER BY invoice_id, position")
    .all() as ItemRow[];
  const itemsByInvoice = new Map<string, ItemRow[]>();
  for (const item of itemRows) {
    const list = itemsByInvoice.get(item.invoice_id) ?? [];
    list.push(item);
    itemsByInvoice.set(item.invoice_id, list);
  }
  return invoiceRows.map((row) => mapInvoice(row, itemsByInvoice.get(row.id) ?? []));
}

export function getInvoice(id: string): Invoice | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM invoices WHERE id = ?").get(id) as InvoiceRow | undefined;
  if (!row) return null;
  const items = db
    .prepare("SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY position")
    .all(id) as ItemRow[];
  return mapInvoice(row, items);
}

function writeItems(invoiceId: string, items: InvoiceWrite["items"]): void {
  const db = getDb();
  db.prepare("DELETE FROM invoice_items WHERE invoice_id = ?").run(invoiceId);
  const insert = db.prepare(
    "INSERT INTO invoice_items (id, invoice_id, position, description, quantity_milli, unit_price_minor) VALUES (?, ?, ?, ?, ?, ?)",
  );
  items.forEach((item, index) => {
    insert.run(item.id, invoiceId, index, item.description, item.quantityMilli, item.unitPriceMinor);
  });
}

function toUniqueError(error: unknown, number: string): unknown {
  const message = error instanceof Error ? error.message : String(error);
  if (/UNIQUE constraint failed/i.test(message) && /invoices\.number/i.test(message)) {
    return new DuplicateInvoiceNumberError(number);
  }
  return error;
}

const INSERT_INVOICE = `INSERT INTO invoices
  (id, number, status, issue_date, due_date, customer_id, customer_snapshot,
   tax_rate_bps, discount_minor, currency, notes, terms, issued_snapshot, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const UPDATE_INVOICE = `UPDATE invoices SET
  number = ?, status = ?, issue_date = ?, due_date = ?, customer_id = ?, customer_snapshot = ?,
  tax_rate_bps = ?, discount_minor = ?, currency = ?, notes = ?, terms = ?, issued_snapshot = ?, updated_at = ?
  WHERE id = ?`;

export function createInvoice(input: InvoiceWrite, now: string = new Date().toISOString()): Invoice {
  const id = crypto.randomUUID();
  transact(() => {
    const db = getDb();
    try {
      db.prepare(INSERT_INVOICE).run(
        id,
        input.number,
        input.status,
        input.issueDate,
        input.dueDate,
        input.customerId,
        JSON.stringify(input.customer),
        input.taxRateBps,
        input.discountMinor,
        input.currency,
        input.notes,
        input.terms,
        input.issuedSnapshot ? JSON.stringify(input.issuedSnapshot) : null,
        now,
        now,
      );
    } catch (error) {
      throw toUniqueError(error, input.number);
    }
    writeItems(id, input.items);
  });
  const created = getInvoice(id);
  if (!created) throw new Error("The invoice could not be read back after creation.");
  return created;
}

export function updateInvoice(
  id: string,
  input: InvoiceWrite,
  now: string = new Date().toISOString(),
): Invoice | null {
  let found = false;
  transact(() => {
    const db = getDb();
    try {
      const result = db
        .prepare(UPDATE_INVOICE)
        .run(
          input.number,
          input.status,
          input.issueDate,
          input.dueDate,
          input.customerId,
          JSON.stringify(input.customer),
          input.taxRateBps,
          input.discountMinor,
          input.currency,
          input.notes,
          input.terms,
          input.issuedSnapshot ? JSON.stringify(input.issuedSnapshot) : null,
          now,
          id,
        );
      found = Number(result.changes) > 0;
    } catch (error) {
      throw toUniqueError(error, input.number);
    }
    if (found) writeItems(id, input.items);
  });
  return found ? getInvoice(id) : null;
}

/** Removing an invoice cascades to its items and payments (FK ON DELETE CASCADE). */
export function deleteInvoice(id: string): boolean {
  const result = getDb().prepare("DELETE FROM invoices WHERE id = ?").run(id);
  return Number(result.changes) > 0;
}

/**
 * Issues a draft invoice in one UPDATE: status, dates and the frozen snapshot
 * land together, and the `status = 'draft'` guard makes double-issuing a
 * no-op instead of a corruption vector.
 */
export function markIssued(
  id: string,
  input: { issueDate: string; dueDate: string; issuedSnapshot: IssuedSnapshot },
  now: string = new Date().toISOString(),
): Invoice | null {
  const result = getDb()
    .prepare(
      "UPDATE invoices SET status = 'issued', issue_date = ?, due_date = ?, issued_snapshot = ?, updated_at = ? WHERE id = ? AND status = 'draft'",
    )
    .run(input.issueDate, input.dueDate, JSON.stringify(input.issuedSnapshot), now, id);
  return Number(result.changes) > 0 ? getInvoice(id) : null;
}
