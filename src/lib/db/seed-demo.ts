import type { DatabaseSync } from "node:sqlite";
import { buildIssuedSnapshot } from "../domain/status";
import { addDaysISO, todayISO } from "../format";
import { isDemoMode } from "../demo";
import type { CustomerSnapshot, InvoiceStatus, IssuedSnapshot } from "../types";

/**
 * Seeds a fresh demo database with synthetic data so the hosted sandbox
 * doesn't look empty. Runs only in demo mode, only when the database is
 * still empty — a restart keeps whatever visitors created until the
 * platform recycles the instance anyway (/tmp is ephemeral).
 */
export function maybeSeedDemo(db: DatabaseSync): void {
  if (!isDemoMode()) return;
  const clients = (db.prepare("SELECT COUNT(*) AS n FROM clients").get() as { n: number }).n;
  const invoices = (db.prepare("SELECT COUNT(*) AS n FROM invoices").get() as { n: number }).n;
  if (clients > 0 || invoices > 0) return;

  const now = new Date().toISOString();
  const today = todayISO();

  db.exec("BEGIN");
  try {
    const insertClient = db.prepare(
      "INSERT INTO clients (id, name, email, address, created_at) VALUES (?, ?, ?, ?, ?)",
    );
    const acme: CustomerSnapshot = { name: "Acme Corp", email: "billing@acme.com", address: "42 Market Street\nSan Francisco, CA 94103" };
    const globex: CustomerSnapshot = { name: "Globex Ltd", email: "accounts@globex.io", address: "1 Harbour Road\nSingapore 018981" };
    const initech: CustomerSnapshot = { name: "Initech", email: "ap@initech.dev", address: "742 Evergreen Terrace\nSpringfield" };
    insertClient.run("c-1", acme.name, acme.email, acme.address, now);
    insertClient.run("c-2", globex.name, globex.email, globex.address, now);
    insertClient.run("c-3", initech.name, initech.email, initech.address, now);

    const insertInvoice = db.prepare(
      `INSERT INTO invoices
        (id, number, status, issue_date, due_date, customer_id, customer_snapshot,
         tax_rate_bps, discount_minor, currency, notes, terms, issued_snapshot, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertItem = db.prepare(
      "INSERT INTO invoice_items (invoice_id, id, position, description, quantity_milli, unit_price_minor) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const insertPayment = db.prepare(
      "INSERT INTO payments (id, invoice_id, amount_minor, date, method, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );

    const addInvoice = (input: {
      id: string;
      number: string;
      status: InvoiceStatus;
      issueDate: string;
      dueDate: string;
      customerId: string;
      customer: CustomerSnapshot;
      items: Array<{ id: string; description: string; quantityMilli: number; unitPriceMinor: number }>;
      taxRateBps: number;
      discountMinor?: number;
      notes: string;
      terms: string;
    }) => {
      const snapshot: IssuedSnapshot | null =
        input.status === "issued"
          ? buildIssuedSnapshot(
              { ...input, discountMinor: input.discountMinor ?? 0 },
              new Date(`${input.issueDate}T10:00:00`).toISOString(),
            )
          : null;
      insertInvoice.run(
        input.id,
        input.number,
        input.status,
        input.issueDate,
        input.dueDate,
        input.customerId,
        JSON.stringify(input.customer),
        input.taxRateBps,
        input.discountMinor ?? 0,
        "USD",
        input.notes,
        input.terms,
        snapshot ? JSON.stringify(snapshot) : null,
        now,
        now,
      );
      input.items.forEach((item, position) => {
        insertItem.run(input.id, item.id, position, item.description, item.quantityMilli, item.unitPriceMinor);
      });
    };

    const defaultTerms = "Payment due within 30 days of the invoice date.";

    // Paid in full
    addInvoice({
      id: "inv-1", number: "INV-0001", status: "issued",
      issueDate: addDaysISO(today, -40), dueDate: addDaysISO(today, -10),
      customerId: "c-1", customer: acme,
      items: [
        { id: "i-1", description: "Website redesign", quantityMilli: 1000, unitPriceMinor: 250000 },
        { id: "i-2", description: "Logo refresh", quantityMilli: 1000, unitPriceMinor: 80000 },
      ],
      taxRateBps: 0, notes: "Thanks for your business!", terms: defaultTerms,
    });
    insertPayment.run("pay-1", "inv-1", 330000, addDaysISO(today, -12), "Bank transfer", "", now);

    // Partially paid
    addInvoice({
      id: "inv-2", number: "INV-0002", status: "issued",
      issueDate: addDaysISO(today, -20), dueDate: addDaysISO(today, 10),
      customerId: "c-2", customer: globex,
      items: [{ id: "i-3", description: "Consulting hours", quantityMilli: 12000, unitPriceMinor: 15000 }],
      taxRateBps: 800, notes: "", terms: defaultTerms,
    });
    insertPayment.run("pay-2", "inv-2", 100000, addDaysISO(today, -5), "Bank transfer", "First installment", now);

    // Draft
    addInvoice({
      id: "inv-3", number: "INV-0003", status: "draft",
      issueDate: addDaysISO(today, -2), dueDate: addDaysISO(today, 28),
      customerId: "c-3", customer: initech,
      items: [
        { id: "i-4", description: "API integration", quantityMilli: 1000, unitPriceMinor: 120000 },
        { id: "i-5", description: "Data migration", quantityMilli: 1000, unitPriceMinor: 65000 },
      ],
      taxRateBps: 0, notes: "", terms: "",
    });

    // Overdue
    addInvoice({
      id: "inv-4", number: "INV-0004", status: "issued",
      issueDate: addDaysISO(today, -25), dueDate: addDaysISO(today, -5),
      customerId: "c-1", customer: acme,
      items: [{ id: "i-6", description: "Monthly support retainer", quantityMilli: 1000, unitPriceMinor: 50000 }],
      taxRateBps: 0, notes: "", terms: defaultTerms,
    });

    // Settings: mark setup done so the welcome card doesn't greet demo visitors.
    db.prepare("INSERT OR IGNORE INTO app_settings (id) VALUES (1)").run();
    db.prepare("INSERT OR IGNORE INTO business_settings (id) VALUES (1)").run();
    db.prepare("UPDATE app_settings SET setup_completed = 1 WHERE id = 1").run();
    db.prepare("UPDATE business_settings SET company_name = 'Ticky Demo' WHERE id = 1").run();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
