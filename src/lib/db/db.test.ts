import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, dbPath, getDb, useTestDataDir } from "./connection";
import { LATEST_VERSION } from "./migrations";
import {
  DuplicateInvoiceNumberError,
  type InvoiceWrite,
} from "../store";
import { createPayment, listPaymentsForInvoice } from "./payments";
import { updateInvoice as rawUpdateInvoice } from "./invoices";

// ---- shared fixture ----

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ticky-db-test-"));
  useTestDataDir(dir);
});

afterAll(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

function invoiceInput(overrides: Partial<InvoiceWrite> = {}): InvoiceWrite {
  return {
    number: "INV-0001",
    status: "draft",
    issueDate: "2026-10-16",
    dueDate: "2026-11-15",
    customerId: null,
    customer: { name: "Acme Corp", email: "billing@acme.com", address: "42 Market Street" },
    items: [
      { id: "i-1", description: "Consulting hours", quantityMilli: 12000, unitPriceMinor: 15000 },
      { id: "i-2", description: "Support retainer", quantityMilli: 1000, unitPriceMinor: 50000 },
    ],
    taxRateBps: 800,
    discountMinor: 2000,
    currency: "USD",
    notes: "Thanks!",
    terms: "Net 30.",
    issuedSnapshot: null,
    ...overrides,
  };
}

// ---- migrations ----

describe("migrations", () => {
  it("applies the schema and stamps user_version", () => {
    const db = getDb();
    const row = db.prepare("PRAGMA user_version").get() as { user_version?: number };
    expect(Number(row?.user_version)).toBeGreaterThanOrEqual(LATEST_VERSION);

    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>
    ).map((t) => t.name);
    for (const expected of [
      "business_settings",
      "app_settings",
      "clients",
      "invoices",
      "invoice_items",
      "payments",
    ]) {
      expect(tables).toContain(expected);
    }
  });
});

// ---- invoices ----

describe("invoice repository", () => {
  it("creates and reads back an invoice with ordered items and JSON snapshots", async () => {
    const { createInvoiceRecord, getInvoiceById } = await import("../store");
    const created = await createInvoiceRecord({
      ...invoiceInput(),
      number: undefined,
    });
    // number was auto-generated from settings (INV-0001) and the counter bumped
    expect(created.number).toBe("INV-0001");
    expect(created.items.map((item) => item.description)).toEqual(["Consulting hours", "Support retainer"]);
    expect(created.customer).toEqual({ name: "Acme Corp", email: "billing@acme.com", address: "42 Market Street" });

    const read = await getInvoiceById(created.id);
    expect(read).not.toBeNull();
    expect(read?.items[0]).toEqual({ id: "i-1", description: "Consulting hours", quantityMilli: 12000, unitPriceMinor: 15000 });
    expect(read?.taxRateBps).toBe(800);
    expect(read?.discountMinor).toBe(2000);
  });

  it("bumps the invoice number sequence on every create", async () => {
    const { createInvoiceRecord, getSettings } = await import("../store");
    const second = await createInvoiceRecord({ ...invoiceInput(), number: undefined, status: "issued" });
    expect(second.number).toBe("INV-0002");
    // born issued → snapshot frozen immediately
    expect(second.issuedSnapshot?.totals.totalMinor).toBeGreaterThan(0);
    expect((await getSettings()).nextInvoiceNumber).toBe(3);
  });

  it("rejects a duplicate invoice number with a domain error", async () => {
    const { createInvoiceRecord } = await import("../store");
    await expect(createInvoiceRecord(invoiceInput({ number: "INV-0001" }))).rejects.toThrow(
      DuplicateInvoiceNumberError,
    );
  });

  it("replaces items atomically and rolls back fully on a constraint failure", async () => {
    const { createInvoiceRecord, getInvoiceById, updateInvoiceRecord } = await import("../store");
    const created = await createInvoiceRecord({ ...invoiceInput(), number: undefined });

    const changed = await updateInvoiceRecord(created.id, invoiceInput({
      number: created.number,
      items: [{ id: "n-1", description: "Only line", quantityMilli: 1000, unitPriceMinor: 12345 }],
    }));
    expect(changed?.items).toHaveLength(1);
    expect(changed?.items[0].unitPriceMinor).toBe(12345);

    // A poisoned item violates the CHECK — the whole update must roll back.
    expect(() =>
      rawUpdateInvoice(created.id, invoiceInput({
        number: created.number,
        items: [{ id: "n-1", description: "Bad line", quantityMilli: 1000, unitPriceMinor: -1 }],
      })),
    ).toThrow();
    const after = await getInvoiceById(created.id);
    expect(after?.items).toHaveLength(1);
    expect(after?.items[0].unitPriceMinor).toBe(12345);
  });

  it("deleting an invoice cascades to items and payments", async () => {
    const { createInvoiceRecord, deleteInvoiceRecord, getInvoiceById } = await import("../store");
    const created = await createInvoiceRecord({ ...invoiceInput(), number: undefined });
    createPayment({
      invoiceId: created.id,
      amountMinor: 50000,
      date: "2026-10-16",
      method: "Bank transfer",
      note: "",
    });

    expect(await deleteInvoiceRecord(created.id)).toBe(true);
    expect(await getInvoiceById(created.id)).toBeNull();
    expect(listPaymentsForInvoice(created.id)).toHaveLength(0);
    const db = getDb();
    const items = db.prepare("SELECT * FROM invoice_items WHERE invoice_id = ?").all(created.id);
    expect(items).toHaveLength(0);
  });
});

// ---- payments ----

describe("payments repository", () => {
  it("lists payments per invoice", async () => {
    const { createInvoiceRecord } = await import("../store");
    const invoice = await createInvoiceRecord({ ...invoiceInput(), number: undefined });
    createPayment({ invoiceId: invoice.id, amountMinor: 10000, date: "2026-10-16", method: "Cash", note: "" });
    createPayment({ invoiceId: invoice.id, amountMinor: 5000, date: "2026-10-17", method: "Cash", note: "" });
    const payments = listPaymentsForInvoice(invoice.id);
    expect(payments).toHaveLength(2);
    expect(payments.every((p) => p.invoiceId === invoice.id)).toBe(true);
  });

  it("refuses payments for missing invoices (FK)", () => {
    expect(() =>
      createPayment({ invoiceId: "nope", amountMinor: 1000, date: "2026-10-16", method: "", note: "" }),
    ).toThrow();
  });
});

// ---- clients ----

describe("client repository", () => {
  it("syncs draft invoice snapshots but leaves issued ones frozen", async () => {
    const { createCustomerRecord, createInvoiceRecord, getCustomers, updateCustomerRecord } = await import("../store");
    const client = await createCustomerRecord({ name: "Globex Ltd", email: "a@globex.io", address: "1 Harbour Road" });

    const draft = await createInvoiceRecord({
      ...invoiceInput(),
      number: undefined,
      customerId: client.id,
      status: "draft",
    });
    const issued = await createInvoiceRecord({
      ...invoiceInput(),
      number: undefined,
      status: "issued",
      customerId: client.id,
    });

    const updated = await updateCustomerRecord(client.id, {
      name: "Globex International",
      email: "a@globex.io",
      address: "1 Harbour Road",
    });
    expect(updated?.name).toBe("Globex International");

    const customers = await getCustomers();
    expect(customers).toHaveLength(1);

    const { getInvoiceById } = await import("../store");
    const draftAfter = await getInvoiceById(draft.id);
    const issuedAfter = await getInvoiceById(issued.id);
    // Draft follows the client…
    expect(draftAfter?.customer.name).toBe("Globex International");
    // …issued keeps the frozen customer (the snapshot governs display anyway)
    expect(issuedAfter?.issuedSnapshot?.customer.name).toBe("Acme Corp");
  });

  it("nulls the customer link on delete (FK SET NULL)", async () => {
    const { createCustomerRecord, createInvoiceRecord, deleteCustomerRecord, getCustomerById } = await import("../store");
    const client = await createCustomerRecord({ name: "Initech", email: "", address: "" });
    const invoice = await createInvoiceRecord({
      ...invoiceInput(),
      number: undefined,
      customerId: client.id,
      status: "draft",
    });

    expect(await deleteCustomerRecord(client.id)).toBe(true);
    expect(await getCustomerById(client.id)).toBeNull();

    const { getInvoiceById } = await import("../store");
    const invoiceAfter = await getInvoiceById(invoice.id);
    expect(invoiceAfter?.customerId).toBeNull();
    // the snapshot survives
    expect(invoiceAfter?.customer.name).toBe("Acme Corp");
  });
});

// ---- settings ----

describe("settings repository", () => {
  it("creates defaults on first read and round-trips writes", async () => {
    const { getSettings, saveSettings } = await import("../store");
    const defaults = await getSettings();
    expect(defaults.companyName).toBe("My Company");
    expect(defaults.nextInvoiceNumber).toBeGreaterThan(0);
    expect(defaults.aiModel.length).toBeGreaterThan(0);

    const changed = { ...defaults, companyName: "Ticky Ltd", defaultTaxRate: 8.5, currency: "EUR" };
    await saveSettings(changed);
    expect((await getSettings()).companyName).toBe("Ticky Ltd");
    expect((await getSettings()).defaultTaxRate).toBe(8.5);
    expect((await getSettings()).currency).toBe("EUR");
  });
});

// ---- issue / duplicate / catalog ----

describe("issue and duplicate", () => {
  it("issues a draft once, freezing the snapshot; re-issuing is rejected", async () => {
    const { createInvoiceRecord, issueInvoiceRecord, getInvoiceById } = await import("../store");
    const draft = await createInvoiceRecord({ ...invoiceInput(), number: undefined });

    const issued = await issueInvoiceRecord(draft.id, { issueDate: "2026-10-16", dueDate: "2026-11-15" });
    expect(issued.status).toBe("issued");
    expect(issued.issueDate).toBe("2026-10-16");
    // snapshot frozen at the totals the invoice had at issue time
    expect(issued.issuedSnapshot?.totals.totalMinor).toBeGreaterThan(0);
    expect(issued.issuedSnapshot?.customer.name).toBe("Acme Corp");

    // second issue is blocked by the domain rule
    await expect(issueInvoiceRecord(draft.id)).rejects.toThrow(/only a draft/i);

    // and even a raw re-run is a no-op thanks to the status guard
    expect((await getInvoiceById(draft.id))?.status).toBe("issued");
  });

  it("duplicates any invoice into a draft with fresh ids and the next number", async () => {
    const { createInvoiceRecord, issueInvoiceRecord, duplicateInvoiceRecord, getSettings } = await import("../store");
    const original = await createInvoiceRecord({ ...invoiceInput(), number: undefined });
    await issueInvoiceRecord(original.id);

    const copy = await duplicateInvoiceRecord(original.id);
    expect(copy).not.toBeNull();
    expect(copy!.status).toBe("draft");
    expect(copy!.number).not.toBe(original.number);
    expect(copy!.issuedSnapshot).toBeNull();
    expect(copy!.items).toHaveLength(original.items.length);
    expect(copy!.items.map((item) => item.id)).not.toEqual(original.items.map((item) => item.id));
    expect((await getSettings()).nextInvoiceNumber).toBeGreaterThan(2);

    expect(await duplicateInvoiceRecord("does-not-exist")).toBeNull();
  });
});

describe("item catalog", () => {
  it("learns saved items, bumps usage and refreshes the price", async () => {
    const { createInvoiceRecord, getItemCatalog } = await import("../store");

    await createInvoiceRecord({
      ...invoiceInput(),
      number: undefined,
      items: [{ id: "c-1", description: "Voiceover work", quantityMilli: 1000, unitPriceMinor: 12000 }],
    });
    await createInvoiceRecord({
      ...invoiceInput(),
      number: undefined,
      items: [{ id: "c-2", description: "Voiceover work", quantityMilli: 2000, unitPriceMinor: 15000 }],
    });

    const catalog = await getItemCatalog();
    const entry = catalog.find((item) => item.description === "Voiceover work");
    expect(entry).toBeDefined();
    expect(entry!.timesUsed).toBe(2);
    expect(entry!.unitPriceMinor).toBe(15000); // latest price wins
  });

  it("updates catalog entries through updateInvoiceRecord too", async () => {
    const { createInvoiceRecord, updateInvoiceRecord, getItemCatalog } = await import("../store");
    const created = await createInvoiceRecord({
      ...invoiceInput(),
      number: undefined,
      items: [{ id: "u-1", description: "Coaching session", quantityMilli: 1000, unitPriceMinor: 9000 }],
    });
    await updateInvoiceRecord(created.id, invoiceInput({
      number: created.number,
      items: [{ id: "u-1", description: "Coaching session", quantityMilli: 1000, unitPriceMinor: 11000 }],
    }));

    const entry = (await getItemCatalog()).find((item) => item.description === "Coaching session");
    expect(entry!.unitPriceMinor).toBe(11000);
    expect(entry!.timesUsed).toBe(2);
  });
});

// ---- backup / restore ----

describe("backup and restore", () => {
  it("round-trips: backup → wipe → restore → data is back", async () => {
    const store = await import("../store");
    const before = (await store.getInvoices()).length;
    expect(before).toBeGreaterThan(0);

    const backupPath = await store.backupDatabase();
    expect(existsSync(backupPath)).toBe(true);
    expect((await store.listDatabaseBackups()).length).toBe(1);

    // wipe everything
    for (const invoice of await store.getInvoices()) {
      await store.deleteInvoiceRecord(invoice.id);
    }
    expect((await store.getInvoices()).length).toBe(0);

    const result = await store.restoreDatabaseBackup(backupPath);
    expect(existsSync(result.previousDataAt)).toBe(true);
    expect((await store.getInvoices()).length).toBe(before);
  });

  it("rejects files that are not healthy Ticky backups", async () => {
    const store = await import("../store");
    const fake = path.join(dir, "fake-backup.db");
    writeFileSync(fake, "this is definitely not a sqlite database");

    await expect(store.restoreDatabaseBackup(fake)).rejects.toThrow(/not a|could not be read/i);
    // the live database must be untouched after a failed restore
    expect((await store.getInvoices()).length).toBeGreaterThan(0);
    expect(existsSync(dbPath())).toBe(true);
  });
});

// ---- persistence ----

describe("persistence across reopens", () => {
  it("keeps data after closing and reopening the connection", async () => {
    const store = await import("../store");
    const count = (await store.getInvoices()).length;
    expect(count).toBeGreaterThan(0);

    closeDb();
    // next call reopens lazily from disk
    expect((await store.getInvoices()).length).toBe(count);
  });
});
