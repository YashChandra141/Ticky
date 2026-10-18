import { getDb } from "./connection";
import type { Payment } from "../types";

type PaymentRow = {
  id: string;
  invoice_id: string;
  amount_minor: number;
  date: string;
  method: string;
  note: string;
  created_at: string;
};

function map(row: PaymentRow): Payment {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    amountMinor: row.amount_minor,
    date: row.date,
    method: row.method,
    note: row.note,
    createdAt: row.created_at,
  };
}

export function listPayments(): Payment[] {
  const rows = getDb()
    .prepare("SELECT * FROM payments ORDER BY date DESC, created_at DESC")
    .all() as PaymentRow[];
  return rows.map(map);
}

export function listPaymentsForInvoice(invoiceId: string): Payment[] {
  const rows = getDb()
    .prepare("SELECT * FROM payments WHERE invoice_id = ? ORDER BY date DESC, created_at DESC")
    .all(invoiceId) as PaymentRow[];
  return rows.map(map);
}

/** The FK on invoice_id enforces that the invoice actually exists. */
export function createPayment(input: {
  invoiceId: string;
  amountMinor: number;
  date: string;
  method: string;
  note: string;
}): Payment {
  const payment: Payment = {
    id: crypto.randomUUID(),
    invoiceId: input.invoiceId,
    amountMinor: input.amountMinor,
    date: input.date,
    method: input.method,
    note: input.note,
    createdAt: new Date().toISOString(),
  };
  getDb()
    .prepare(
      "INSERT INTO payments (id, invoice_id, amount_minor, date, method, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      payment.id,
      payment.invoiceId,
      payment.amountMinor,
      payment.date,
      payment.method,
      payment.note,
      payment.createdAt,
    );
  return payment;
}

export function deletePayment(id: string): boolean {
  const result = getDb().prepare("DELETE FROM payments WHERE id = ?").run(id);
  return Number(result.changes) > 0;
}
