/**
 * The app-facing store. Pages and routes keep importing `getInvoices`,
 * `getSettings` and friends from here — the JSON-file implementation is
 * gone; every call now hits SQLite through the repositories in `src/lib/db`.
 */
import { formatInvoiceNumber, numberingConfig } from "./domain/numbering";
import { buildIssuedSnapshot, canTransition } from "./domain/status";
import { addDaysISO, todayISO } from "./format";
import { closeDb, transact } from "./db/connection";
import { backupNow, listBackups, restoreBackup, type BackupInfo } from "./db/backup";
import { catalogItems, listCatalog, type CatalogEntry } from "./db/catalog";
import {
  createClient,
  deleteClient,
  getClient,
  listClients,
  updateClient,
} from "./db/clients";
import {
  createInvoice,
  deleteInvoice,
  getInvoice,
  listInvoices,
  markIssued,
  updateInvoice,
  type InvoiceWrite,
} from "./db/invoices";
import {
  createPayment,
  deletePayment,
  listPayments,
  listPaymentsForInvoice,
} from "./db/payments";
import { readSettings, writeSettings } from "./db/settings";
import type { Customer, Invoice, Payment, Settings } from "./types";
import type { z } from "zod";
import type { customerInputSchema, invoiceInputSchema, paymentInputSchema } from "./types";

export { DuplicateInvoiceNumberError } from "./db/errors";
export type { InvoiceWrite } from "./db/invoices";
export type { BackupInfo } from "./db/backup";
export { closeDb };

// ---------- invoices ----------

export async function getInvoices(): Promise<Invoice[]> {
  return listInvoices();
}

export async function getInvoiceById(id: string): Promise<Invoice | null> {
  return getInvoice(id);
}

/**
 * Creates an invoice. When no number is supplied it is generated from the
 * numbering settings, and the sequence counter is bumped — in the same
 * transaction as the insert.
 */
export async function createInvoiceRecord(
  input: z.infer<typeof invoiceInputSchema>,
): Promise<Invoice> {
  return transact(() => {
    const settings = readSettings();
    const number = input.number?.trim() || formatInvoiceNumber(numberingConfig(settings), settings.nextInvoiceNumber);
    const now = new Date().toISOString();
    const invoice = createInvoice(
      {
        ...input,
        number,
        customerId: input.customerId ?? null,
        // An invoice can be born issued — freeze its snapshot right away.
        issuedSnapshot: input.status === "issued" ? buildIssuedSnapshot(input, now) : null,
      },
      now,
    );
    writeSettings({ ...settings, nextInvoiceNumber: settings.nextInvoiceNumber + 1 });
    // Learn the line items for autocomplete.
    catalogItems(input.items);
    return invoice;
  });
}

export async function updateInvoiceRecord(
  id: string,
  input: InvoiceWrite,
): Promise<Invoice | null> {
  return transact(() => {
    const updated = updateInvoice(id, input);
    if (updated) catalogItems(input.items);
    return updated;
  });
}

/**
 * Issues a draft: sets the dates, freezes the customer + totals snapshot, all
 * in one transaction. Non-drafts are rejected.
 */
export async function issueInvoiceRecord(
  id: string,
  dates: { issueDate?: string; dueDate?: string } = {},
): Promise<Invoice> {
  return transact(() => {
    const invoice = getInvoice(id);
    if (!invoice) throw new Error("Invoice not found.");
    if (!canTransition(invoice.status, "issued")) {
      throw new Error(`Only a draft can be issued — this one is ${invoice.status}.`);
    }
    const issueDate = dates.issueDate?.trim() || invoice.issueDate || todayISO();
    const dueDate = dates.dueDate?.trim() || invoice.dueDate || addDaysISO(issueDate, 30);
    const issued = markIssued(
      id,
      { issueDate, dueDate, issuedSnapshot: buildIssuedSnapshot(invoice, new Date().toISOString()) },
    );
    if (!issued) throw new Error("The invoice could not be issued.");
    return issued;
  });
}

/** Copies any invoice into a fresh draft with the next available number. */
export async function duplicateInvoiceRecord(id: string): Promise<Invoice | null> {
  return transact(() => {
    const source = getInvoice(id);
    if (!source) return null;
    const settings = readSettings();
    const number = formatInvoiceNumber(numberingConfig(settings), settings.nextInvoiceNumber);
    const today = todayISO();
    const copy = createInvoice({
      number,
      status: "draft",
      issueDate: today,
      dueDate: addDaysISO(today, 30),
      customerId: source.customerId,
      customer: source.customer,
      items: source.items.map((item) => ({ ...item, id: crypto.randomUUID() })),
      taxRateBps: source.taxRateBps,
      discountMinor: source.discountMinor,
      currency: source.currency,
      notes: source.notes,
      terms: source.terms,
      issuedSnapshot: null,
    });
    writeSettings({ ...settings, nextInvoiceNumber: settings.nextInvoiceNumber + 1 });
    return copy;
  });
}

export async function deleteInvoiceRecord(id: string): Promise<boolean> {
  return deleteInvoice(id);
}

// ---------- customers ----------

export async function getCustomers(): Promise<Customer[]> {
  return listClients();
}

export async function getCustomerById(id: string): Promise<Customer | null> {
  return getClient(id);
}

export async function createCustomerRecord(
  input: z.infer<typeof customerInputSchema>,
): Promise<Customer> {
  return createClient(input);
}

export async function updateCustomerRecord(
  id: string,
  input: z.infer<typeof customerInputSchema>,
): Promise<Customer | null> {
  return updateClient(id, input);
}

export async function deleteCustomerRecord(id: string): Promise<boolean> {
  return deleteClient(id);
}

// ---------- payments ----------

export async function getPayments(): Promise<Payment[]> {
  return listPayments();
}

export async function getPaymentsForInvoice(invoiceId: string): Promise<Payment[]> {
  return listPaymentsForInvoice(invoiceId);
}

export async function createPaymentRecord(
  input: z.infer<typeof paymentInputSchema>,
): Promise<Payment> {
  return createPayment(input);
}

export async function deletePaymentRecord(id: string): Promise<boolean> {
  return deletePayment(id);
}

// ---------- settings ----------

export async function getSettings(): Promise<Settings> {
  return readSettings();
}

export async function saveSettings(settings: Settings): Promise<void> {
  writeSettings(settings);
}

// ---------- item catalog ----------

export async function getItemCatalog(): Promise<CatalogEntry[]> {
  return listCatalog();
}

// ---------- backup / restore ----------

export async function backupDatabase(): Promise<string> {
  return backupNow();
}

export async function listDatabaseBackups(): Promise<BackupInfo[]> {
  return listBackups();
}

export async function restoreDatabaseBackup(file: string): Promise<{ previousDataAt: string }> {
  return restoreBackup(file);
}
